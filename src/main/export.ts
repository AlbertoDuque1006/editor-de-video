import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { ExportEvent, ExportVideoDone } from '../shared/types'
import { totalDuration } from '../shared/project'
import { buildMuxArgs } from './audioMix'
import { ffmpegPath } from './media'

/**
 * La exportación tiene dos fases: la interfaz renderiza la imagen y la va escribiendo aquí por pedazos,
 * y luego FFmpeg mezcla el audio y la une con esa imagen.
 */
interface Job {
  dir: string
  videoPath: string
  fd: number | null
  child: ChildProcess | null
  cancelled: boolean
}

let job: Job | null = null

export function beginExport(webm: boolean): string {
  abortExport()
  const dir = mkdtempSync(join(tmpdir(), 'editor-video-export-'))
  const videoPath = join(dir, webm ? 'imagen.webm' : 'imagen.mp4')
  job = { dir, videoPath, fd: openSync(videoPath, 'w'), child: null, cancelled: false }
  return videoPath
}

export function writeExportChunk(position: number, data: Uint8Array): void {
  if (!job || job.fd === null) throw new Error('No hay una exportación en curso.')
  writeSync(job.fd, data, 0, data.byteLength, position)
}

function cleanup(): void {
  if (!job) return
  if (job.fd !== null) closeSync(job.fd)
  rmSync(job.dir, { recursive: true, force: true })
  job = null
}

export function abortExport(): void {
  if (!job) return
  job.cancelled = true
  if (job.child) job.child.kill()
  else cleanup()
}

export function finishExport(req: ExportVideoDone, emit: (e: ExportEvent) => void): void {
  const j = job
  if (!j || j.fd === null) return emit({ type: 'error', message: 'No hay una exportación en curso.' })
  closeSync(j.fd)
  j.fd = null
  if (!isAbsolute(req.outputPath)) return emit({ type: 'error', message: 'Ruta de salida no válida.' })

  let args: string[]
  try {
    args = buildMuxArgs(req.project, { path: j.videoPath, h264: req.h264 }, req.outputPath)
  } catch (err) {
    cleanup()
    return emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  const total = totalDuration(req.project)
  const child = spawn(ffmpegPath, args, { windowsHide: true })
  j.child = child
  let stderr = ''
  child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-4000)))
  child.stdout.on('data', (d) => {
    const last = [...d.toString().matchAll(/out_time_us=(\d+)/g)].at(-1)
    if (last && total > 0) emit({ type: 'progress', ratio: Math.min(1, Number(last[1]) / 1e6 / total) })
  })
  child.on('error', (err) => {
    cleanup()
    emit({ type: 'error', message: `No se pudo iniciar FFmpeg: ${err.message}` })
  })
  child.on('close', (code) => {
    const cancelled = j.cancelled
    cleanup()
    if (cancelled) {
      rmSync(req.outputPath, { force: true })
      emit({ type: 'cancelled' })
    } else if (code === 0) {
      emit({ type: 'done', outputPath: req.outputPath })
    } else {
      rmSync(req.outputPath, { force: true })
      emit({ type: 'error', message: `FFmpeg terminó con error (${code}).\n${stderr.trim().split('\n').slice(-6).join('\n')}` })
    }
  })
}
