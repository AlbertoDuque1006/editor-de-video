import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import { app, shell } from 'electron'
import type { Project } from '../shared/types'
import { projectContext, RESPONSE_SCHEMA, SYSTEM_PROMPT, type SheetInfo } from './aiPrompt'
import { dataDir, userPath, UUID_RE } from './env'
import { contactSheets } from './media'

export interface AiRequest {
  conversationId: string
  sessionId: string | null
  project: Project
  message: string
  model: string
}

export interface AiResult {
  reply: string
  operations: { op: string; [k: string]: unknown }[]
  sessionId: string | null
  costUsd: number
}

export type AiProgress = { kind: 'status'; text: string }

export interface ClaudeStatus {
  found: boolean
  path: string | null
  version: string | null
}

const isWin = process.platform === 'win32'

async function candidates(custom: string | null): Promise<string[]> {
  const home = app.getPath('home')
  const list = custom ? [custom] : []
  const path = await userPath()
  // En Windows solo el .exe: los atajos .cmd de npm obligan a pasar por la shell y eso permitiría inyectar órdenes.
  const names = isWin ? ['claude.exe'] : ['claude']
  for (const dir of path.split(delimiter)) for (const n of names) list.push(join(dir, n))
  if (isWin) {
    list.push(join(home, '.local', 'bin', 'claude.exe'))
  } else {
    list.push(join(home, '.local/bin/claude'), join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude')
  }
  return list
}

async function findClaude(custom: string | null): Promise<string | null> {
  for (const c of await candidates(custom)) if (c && existsSync(c)) return c
  return null
}

async function spawnEnv(bin: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [dirname(bin), await userPath()].join(delimiter) }
  // Si la app se abre desde una sesión de Claude Code, que el proceso hijo no crea que es una sesión anidada.
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  return env
}

export async function claudeStatus(custom: string | null): Promise<ClaudeStatus> {
  const bin = await findClaude(custom)
  if (!bin) return { found: false, path: null, version: null }
  const env = await spawnEnv(bin)
  const version = await new Promise<string | null>((resolve) => {
    execFile(bin, ['--version'], { env, timeout: 15000 }, (err, stdout) => resolve(err ? null : stdout.trim()))
  })
  return { found: version !== null, path: bin, version }
}

/** Abre una terminal con Claude Code para iniciar sesión (/login) o instalarlo. */
export function openClaudeLogin(): void {
  if (process.platform === 'darwin') {
    spawn('osascript', ['-e', 'tell application "Terminal" to do script "claude"', '-e', 'tell application "Terminal" to activate'])
  } else if (isWin) {
    spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', 'claude'], { detached: true, windowsHide: false })
  } else {
    void shell.openExternal('https://code.claude.com/docs/en/setup')
  }
}

const running = new Map<string, ChildProcess>()

export function cancelAi(conversationId: string): void {
  running.get(conversationId)?.kill()
}

/** Carpeta de trabajo de una conversación: ahí quedan las hojas de cuadros que Claude puede abrir. */
function workDir(conversationId: string): string {
  if (!UUID_RE.test(conversationId)) throw new Error('Conversación no válida')
  return dataDir('ia', conversationId)
}

async function ensureSheets(p: Project, dir: string, progress: (p: AiProgress) => void): Promise<Map<string, SheetInfo[]>> {
  const out = new Map<string, SheetInfo[]>()
  for (const m of p.media) {
    if (m.kind === 'audio') continue
    if (m.kind === 'image') {
      out.set(m.id, [{ file: m.path, from: 0, to: 0, step: 0 }]) // las fotos se abren donde están (--add-dir)
      continue
    }
    const first = join(dir, `${m.id}-01.jpg`)
    if (!existsSync(first)) progress({ kind: 'status', text: `Preparando cuadros de «${m.name}»…` })
    const sheets = existsSync(first) ? listSheets(dir, m.id, m.duration) : await contactSheets(m, dir)
    out.set(m.id, sheets.map((s) => ({ ...s, file: basename(s.file) })))
  }
  return out
}

function listSheets(dir: string, id: string, duration: number): SheetInfo[] {
  const step = Math.max(1, Math.ceil(duration / 48))
  const sheets: SheetInfo[] = []
  for (let i = 1; existsSync(join(dir, `${id}-${String(i).padStart(2, '0')}.jpg`)); i++) {
    const from = (i - 1) * 12 * step
    sheets.push({ file: join(dir, `${id}-${String(i).padStart(2, '0')}.jpg`), from, to: Math.min(duration, from + 12 * step), step })
  }
  return sheets
}

/**
 * Le pide a Claude Code (el instalado en este computador, con la sesión de quien lo usa) que edite el proyecto.
 * Solo puede leer archivos (para ver las hojas de cuadros y las imágenes del proyecto); no escribe ni ejecuta nada.
 */
export async function runAi(req: AiRequest, custom: string | null, progress: (p: AiProgress) => void): Promise<AiResult> {
  const bin = await findClaude(custom)
  if (!bin) throw new Error('No encontré Claude Code en este computador. Instálalo y vuelve a intentar.')
  if (running.has(req.conversationId)) throw new Error('Claude ya está trabajando en esta conversación.')
  const dir = workDir(req.conversationId)
  const sheets = await ensureSheets(req.project, dir, progress)

  const imageDirs = [...new Set(req.project.media.filter((m) => m.kind === 'image').map((m) => dirname(m.path)))]
  const prompt = `Estado actual del proyecto:\n\`\`\`json\n${projectContext(req.project, sheets)}\n\`\`\`\n\nPetición: ${req.message}`
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', req.model,
    '--json-schema', JSON.stringify(RESPONSE_SCHEMA),
    '--system-prompt', SYSTEM_PROMPT,
    '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk',
    '--setting-sources', '', '--strict-mcp-config',
    ...imageDirs.flatMap((d) => ['--add-dir', d]),
    ...(req.sessionId && UUID_RE.test(req.sessionId) ? ['--resume', req.sessionId] : [])
  ]

  progress({ kind: 'status', text: 'Claude está pensando…' })
  const child = spawn(bin, args, { cwd: dir, env: await spawnEnv(bin), windowsHide: true })
  running.set(req.conversationId, child)
  child.stdin.end(prompt)

  return new Promise((resolve, reject) => {
    let buf = ''
    let stderr = ''
    let result: Record<string, unknown> | null = null
    let sessionId: string | null = req.sessionId
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev: Record<string, unknown>
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof ev.session_id === 'string') sessionId = ev.session_id
        if (ev.type === 'assistant') {
          const content = (ev.message as { content?: { type: string; name?: string; input?: { file_path?: string } }[] })?.content ?? []
          for (const block of content) {
            if (block.type === 'tool_use' && block.name === 'Read') progress({ kind: 'status', text: 'Mirando los cuadros del video…' })
            else if (block.type === 'tool_use') progress({ kind: 'status', text: 'Preparando los cambios…' })
          }
        } else if (ev.type === 'result') result = ev
      }
    })
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-4000)))
    child.on('error', (err) => {
      running.delete(req.conversationId)
      reject(new Error(`No se pudo abrir Claude Code: ${err.message}`))
    })
    child.on('close', (code) => {
      running.delete(req.conversationId)
      if (!result) {
        const hint = /log ?in|auth|credential|api key/i.test(stderr) ? ' Parece que falta iniciar sesión en Claude Code.' : ''
        return reject(new Error(code === null ? 'Cancelado.' : `Claude Code terminó sin respuesta.${hint}\n${stderr.trim().slice(-600)}`))
      }
      if (result.is_error) {
        const msg = String(result.result ?? result.subtype ?? 'error')
        const hint = /log ?in|auth|401|credential/i.test(msg) ? ' Abre Claude Code e inicia sesión (/login).' : ''
        return reject(new Error(`Claude Code respondió con un error: ${msg}${hint}`))
      }
      let out = result.structured_output as { reply?: string; operations?: AiResult['operations'] } | undefined
      if (!out && typeof result.result === 'string') {
        try {
          out = JSON.parse(result.result)
        } catch {
          out = { reply: result.result, operations: [] }
        }
      }
      resolve({
        reply: out?.reply ?? '',
        operations: Array.isArray(out?.operations) ? out.operations : [],
        sessionId,
        costUsd: Number(result.total_cost_usd ?? 0)
      })
    })
  })
}
