import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExportEvent, ExportRequest } from '../shared/types'
import { buildFfmpegArgs, sequenceDuration } from './ffmpegArgs'
import { ffmpegPath } from './media'

let current: { child: ChildProcess; cancelled: boolean } | null = null

export function startExport(req: ExportRequest, emit: (e: ExportEvent) => void): void {
  if (current) {
    emit({ type: 'error', message: 'Ya hay una exportación en curso.' })
    return
  }
  const work = mkdtempSync(join(tmpdir(), 'editor-video-export-'))
  const cleanup = () => rmSync(work, { recursive: true, force: true })

  let args: string[]
  try {
    const overlays = req.overlays.map((o, i) => {
      const path = join(work, `capa-${i}.png`)
      writeFileSync(path, o.png)
      return { path, start: o.start, end: o.end }
    })
    args = buildFfmpegArgs(req.project, overlays, req.outputPath)
  } catch (err) {
    cleanup()
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    return
  }

  const total = sequenceDuration(req.project)
  const child = spawn(ffmpegPath, args, { windowsHide: true })
  const job = { child, cancelled: false }
  current = job

  let stderrTail = ''
  child.stderr?.on('data', (d) => (stderrTail = (stderrTail + d.toString()).slice(-4000)))
  child.stdout?.on('data', (d) => {
    const times = [...d.toString().matchAll(/out_time_us=(\d+)/g)]
    const last = times.at(-1)
    if (last && total > 0) emit({ type: 'progress', ratio: Math.min(1, Number(last[1]) / 1e6 / total) })
  })
  child.on('error', (err) => {
    current = null
    cleanup()
    emit({ type: 'error', message: `No se pudo iniciar FFmpeg: ${err.message}` })
  })
  child.on('close', (code) => {
    current = null
    cleanup()
    if (job.cancelled) {
      rmSync(req.outputPath, { force: true })
      emit({ type: 'cancelled' })
    } else if (code === 0) {
      emit({ type: 'done', outputPath: req.outputPath })
    } else {
      rmSync(req.outputPath, { force: true })
      const lines = stderrTail.trim().split('\n').slice(-6).join('\n')
      emit({ type: 'error', message: `FFmpeg terminó con error (${code}).\n${lines}` })
    }
  })
}

export function cancelExport(): void {
  if (!current) return
  current.cancelled = true
  current.child.kill()
}
