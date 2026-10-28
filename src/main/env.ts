import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { app } from 'electron'

/** Carpeta de datos de la app (copias para editar, modelos de Whisper, trabajo de la IA, ajustes). */
export function dataDir(...parts: string[]): string {
  const dir = join(app.getPath('userData'), ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

let shellPath: Promise<string> | null = null

/**
 * Las apps abiertas desde el Dock no heredan el PATH de la terminal, así que no encuentran `claude` ni `node`.
 * En Mac se pide el PATH a la shell de inicio de sesión una sola vez.
 */
export function userPath(): Promise<string> {
  shellPath ??= new Promise((resolve) => {
    const base = process.env.PATH ?? ''
    if (process.platform === 'win32') return resolve(base)
    const shell = process.env.SHELL || '/bin/zsh'
    execFile(shell, ['-lc', 'printf "%s" "$PATH"'], { timeout: 5000 }, (err, stdout) => {
      const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(app.getPath('home'), '.local/bin')]
      const parts = [...(err ? [] : stdout.split(delimiter)), ...base.split(delimiter), ...extra]
      resolve([...new Set(parts.filter(Boolean))].join(delimiter))
    })
  })
  return shellPath
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
