import {
  ALL_FORMATS,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  UrlSource,
  WebMOutputFormat,
  canEncodeVideo,
  type StreamTargetChunk,
  type WrappedCanvas
} from 'mediabunny'
import { mediaUrl } from '../../../shared/mediaUrl'
import { findMedia, itemEnd, totalDuration } from '../../../shared/project'
import type { MediaItem, Project, VideoClip } from '../../../shared/types'
import { FORMATS, FPS } from '../../../shared/types'
import { drawFrame, type Drawable, type FrameSource } from './compose'
import { editPath } from './player'

const HIGH = new Quality('high')

export interface RenderJob {
  cancelled: boolean
}

/** Escribe por pedazos en un archivo del proceso principal (las posiciones pueden repetirse al cerrar el MP4). */
export type ChunkWriter = (position: number, data: Uint8Array) => Promise<void>

/**
 * Renderiza solo la imagen del video, cuadro a cuadro, con el mismo compositor de la vista previa.
 * Usa el codificador del sistema (H.264 en MP4; si no hay, VP9 en WebM y el proceso principal lo convierte).
 */
export async function renderVideo(project: Project, h264: boolean, write: ChunkWriter, onProgress: (r: number) => void, job: RenderJob): Promise<void> {
  const { width: W, height: H } = FORMATS[project.format]
  const total = totalDuration(project)
  const frames = Math.max(1, Math.round(total * FPS))

  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => write(chunk.position, chunk.data) })
  const output = new Output({
    format: h264 ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 })
  })
  const source = new CanvasSource(canvas, { codec: h264 ? 'avc' : 'vp9', bitrate: HIGH, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: FPS })

  const inputs = new Map<string, Input>()
  const iterators = new Map<string, AsyncGenerator<WrappedCanvas | null, void, unknown>>()
  const images = new Map<string, ImageBitmap>()
  const current = new Map<string, Drawable>()

  const frameSource: FrameSource = {
    clipFrame: (clip: VideoClip) => current.get(clip.id) ?? null
  }

  try {
    // Prepara un lector por clip con la lista exacta de momentos que va a necesitar.
    for (const track of project.tracks) {
      if (track.hidden || track.kind === 'audio') continue
      for (const item of track.items) {
        if (item.type !== 'video' && item.type !== 'image') continue
        const media = findMedia(project, item.mediaId)
        if (!media) continue
        if (item.type === 'image') {
          if (!images.has(media.id)) images.set(media.id, await loadBitmap(media))
          const bmp = images.get(media.id)!
          current.set(item.id, { source: bmp, width: bmp.width, height: bmp.height })
          continue
        }
        let input = inputs.get(media.id)
        if (!input) {
          input = new Input({ formats: ALL_FORMATS, source: new UrlSource(mediaUrl(editPath(media))) })
          inputs.set(media.id, input)
        }
        const vt = await input.getPrimaryVideoTrack()
        if (!vt || !(await vt.canDecode())) throw new Error(`No se puede leer el video «${media.name}».`)
        const times: number[] = []
        for (let f = 0; f < frames; f++) {
          const t = f / FPS
          if (t >= item.start && t < itemEnd(item)) times.push(item.in + (t - item.start) * item.speed)
        }
        iterators.set(item.id, new CanvasSink(vt, { poolSize: 2 }).canvasesAtTimestamps(times))
      }
    }

    await output.start()
    for (let f = 0; f < frames; f++) {
      if (job.cancelled) throw new Cancelled()
      const t = f / FPS
      for (const track of project.tracks) {
        for (const item of track.items) {
          if (item.type !== 'video' || t < item.start || t >= itemEnd(item)) continue
          const next = await iterators.get(item.id)?.next()
          const wc = next && !next.done ? next.value : null
          if (wc) current.set(item.id, { source: wc.canvas, width: wc.canvas.width, height: wc.canvas.height })
        }
      }
      drawFrame(ctx, project, t, W, H, frameSource)
      await source.add(t, 1 / FPS)
      if (f % 5 === 0) onProgress(f / frames)
    }
    await output.finalize()
    onProgress(1)
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  } finally {
    for (const it of iterators.values()) await it.return().catch(() => {})
    for (const input of inputs.values()) input.dispose()
    for (const bmp of images.values()) bmp.close()
  }
}

/** true si este equipo puede codificar H.264 en el formato del proyecto (si no, se usa VP9). */
export function canEncodeH264(project: Project): Promise<boolean> {
  const { width, height } = FORMATS[project.format]
  return canEncodeVideo('avc', { width, height, bitrate: HIGH })
}

/** true si el video se puede decodificar tal cual (si no, hay que crear una copia para editar). */
export async function canDecode(m: MediaItem): Promise<boolean> {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(mediaUrl(editPath(m))) })
  try {
    const vt = await input.getPrimaryVideoTrack()
    return !!vt && (await vt.canDecode())
  } catch {
    return false
  } finally {
    input.dispose()
  }
}

export class Cancelled extends Error {
  constructor() {
    super('Exportación cancelada')
  }
}

async function loadBitmap(m: MediaItem): Promise<ImageBitmap> {
  const res = await fetch(mediaUrl(m.path))
  if (!res.ok) throw new Error(`No se pudo leer la imagen «${m.name}».`)
  return createImageBitmap(await res.blob())
}
