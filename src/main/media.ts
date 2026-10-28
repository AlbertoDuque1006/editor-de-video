import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import type { MediaItem, MediaKind } from '../shared/types'
import { mediaUrl } from '../shared/mediaUrl'
import { dataDir, UUID_RE } from './env'

// Dentro del instalador el binario queda fuera del .asar, que no se puede ejecutar.
export const ffmpegPath = (ffmpegStatic ?? 'ffmpeg').replace('app.asar', 'app.asar.unpacked')

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.aiff', '.aif'])
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'm2ts', 'wmv', 'flv', '3gp']
export const MEDIA_EXTENSIONS = [...VIDEO_EXT, ...[...IMAGE_EXT, ...AUDIO_EXT].map((e) => e.slice(1))]

// Lo que el reproductor de la app puede abrir directamente; el resto se convierte a una copia H.264.
const PLAYABLE_CONTAINERS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const PLAYABLE_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1'])

/** Solo archivos locales que existen: evita que un proyecto ajeno haga leer URLs u otros protocolos a FFmpeg. */
/** Rutas de red o de dispositivo (\\servidor\..., //servidor/..., \\?\...): abrirlas puede filtrar credenciales de Windows. */
export function isRemotePath(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

export function assertLocalFile(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path) || isRemotePath(path) || /^[a-z][a-z0-9+.-]*:/i.test(path.replace(/^[a-z]:[\\/]/i, ''))) {
    throw new Error(`Ruta no válida: ${path}`)
  }
  if (!statSync(path).isFile()) throw new Error(`No es un archivo: ${path}`)
}

export function runFfmpeg(args: string[], onStdout?: (chunk: string) => void): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-20000)))
    if (onStdout) child.stdout.on('data', (d) => onStdout(d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** Lee el archivo local en path (FFmpeg solo puede abrir archivos). */
export const localInput = (path: string): string[] => ['-protocol_whitelist', 'file', '-i', path]

function parseInfo(stderr: string) {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const v = /Stream #\d+:\d+[^\n]*: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
  let width = v ? Number(v[2]) : 0
  let height = v ? Number(v[3]) : 0
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr)
  if (rot && Math.abs(Number(rot[1])) % 180 === 90) [width, height] = [height, width]
  const hasAudio = /Stream #\d+:\d+[^\n]*: Audio:/.test(stderr)
  return { duration, width, height, codec: v?.[1], hasVideo: Boolean(v), hasAudio }
}

export async function probe(path: string, id: string = randomUUID()): Promise<MediaItem | null> {
  assertLocalFile(path)
  if (!UUID_RE.test(id)) id = randomUUID()
  const { stderr } = await runFfmpeg(['-hide_banner', ...localInput(path)])
  const info = parseInfo(stderr)
  const ext = extname(path).toLowerCase()
  let kind: MediaKind
  if (IMAGE_EXT.has(ext)) kind = 'image'
  else if (AUDIO_EXT.has(ext) || (!info.hasVideo && info.hasAudio)) kind = 'audio'
  else if (info.hasVideo) kind = 'video'
  else return null

  const item: MediaItem = {
    id,
    path,
    name: basename(path),
    kind,
    duration: kind === 'image' ? 0 : info.duration,
    width: info.width,
    height: info.height,
    hasAudio: kind !== 'image' && info.hasAudio,
    codec: info.codec
  }
  if (kind === 'video') {
    const proxy = proxyPath(path)
    if (existsSync(proxy)) item.proxy = proxy
  }
  if (kind !== 'audio') {
    const out = join(dataDir('miniaturas'), `${id}.jpg`)
    const seek = kind === 'video' ? ['-ss', Math.min(1, info.duration / 2).toFixed(2)] : []
    const res = await runFfmpeg([...seek, ...localInput(path), '-frames:v', '1', '-vf', 'scale=240:-2', '-threads', '1', '-y', out])
    if (res.code === 0) item.thumb = mediaUrl(out) + `?v=${Date.now()}`
  }
  return item
}

/** true si el reproductor no puede abrir el video tal cual y conviene crear una copia para editar. */
export function needsProxy(m: MediaItem): boolean {
  return m.kind === 'video' && !m.proxy && (!PLAYABLE_CONTAINERS.has(extname(m.path).toLowerCase()) || !PLAYABLE_CODECS.has(m.codec ?? ''))
}

function proxyPath(path: string): string {
  const st = statSync(path)
  const key = createHash('sha1').update(`${path}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20)
  return join(dataDir('copias'), `${key}.mp4`)
}

/** Copia H.264 de hasta 1920 px de lado, con cuadros clave frecuentes para que adelantar sea rápido. */
export async function makeProxy(m: MediaItem, onProgress: (ratio: number) => void): Promise<string> {
  assertLocalFile(m.path)
  const out = proxyPath(m.path)
  if (existsSync(out)) return out
  const tmp = `${out}.tmp.mp4`
  const scale = "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'"
  const args = [
    '-hide_banner', ...localInput(m.path), '-vf', `${scale},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-y', tmp
  ]
  const res = await runFfmpeg(args, (s) => {
    const last = [...s.matchAll(/out_time_us=(\d+)/g)].at(-1)
    if (last && m.duration > 0) onProgress(Math.min(1, Number(last[1]) / 1e6 / m.duration))
  })
  if (res.code !== 0) {
    rmSync(tmp, { force: true })
    throw new Error(`No se pudo preparar «${m.name}».\n${res.stderr.trim().split('\n').slice(-3).join('\n')}`)
  }
  renameSync(tmp, out)
  return out
}

/** Audio mono a 16 kHz en números de 32 bits, como lo espera Whisper. */
export function decodeAudio16k(path: string): Promise<Float32Array> {
  assertLocalFile(path)
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-v', 'error', ...localInput(path), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { windowsHide: true })
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('No se pudo leer el audio.'))
      const buf = Buffer.concat(chunks)
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)))
    })
  })
}

/** Hojas de cuadros (4 x 3) para que Claude "vea" un video sin leer cientos de imágenes. */
export async function contactSheets(m: MediaItem, dir: string): Promise<{ file: string; from: number; to: number; step: number }[]> {
  if (m.kind === 'image') return [{ file: m.path, from: 0, to: 0, step: 0 }]
  if (m.kind !== 'video') return []
  assertLocalFile(m.path)
  const perSheet = 12
  const step = Math.max(1, Math.ceil(m.duration / 48))
  const pattern = join(dir, `${m.id}-%02d.jpg`)
  const res = await runFfmpeg([
    '-hide_banner', '-v', 'error', ...localInput(m.path),
    '-vf', `fps=1/${step},scale=360:-2,tile=4x3:padding=4:color=white`, '-threads', '1', '-y', pattern
  ])
  if (res.code !== 0) return []
  const sheets: { file: string; from: number; to: number; step: number }[] = []
  for (let i = 1; existsSync(join(dir, `${m.id}-${String(i).padStart(2, '0')}.jpg`)); i++) {
    const from = (i - 1) * perSheet * step
    sheets.push({ file: join(dir, `${m.id}-${String(i).padStart(2, '0')}.jpg`), from, to: Math.min(m.duration, from + perSheet * step), step })
  }
  return sheets
}
