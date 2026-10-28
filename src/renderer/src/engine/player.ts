import { mediaUrl } from '../../../shared/mediaUrl'
import type { AudioItem, MediaItem, Project, VideoClip } from '../../../shared/types'
import { clamp, findMedia, itemEnd, totalDuration, transitionDuration } from '../../../shared/project'
import { drawFrame, type Ctx, type Drawable, type FrameSource, type Hit } from './compose'

// Si un video se desfasa más que esto respecto al reloj, se corrige con un salto.
const MAX_DRIFT = 0.3
// Los videos se preparan un poco antes de que les toque y se sueltan cuando quedan lejos.
const PRELOAD = 2
const RELEASE = 6

const noop = (): void => {}

interface Sound {
  el: HTMLMediaElement
  source: MediaElementAudioSourceNode
  gain: GainNode
}

const imageCache = new Map<string, HTMLImageElement>()

export function cachedImage(path: string): HTMLImageElement | null {
  let img = imageCache.get(path)
  if (!img) {
    img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = mediaUrl(path)
    imageCache.set(path, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** Archivo que se usa para editar: la copia H.264 si existe. */
export const editPath = (m: MediaItem): string => m.proxy ?? m.path

/** Volumen de un clip de la pista principal en t, cruzado durante las transiciones. */
function clipFade(p: Project, clip: VideoClip, t: number): number {
  const main = p.tracks[0]
  const i = main.items.indexOf(clip)
  if (i < 0) return 1
  const prev = main.items[i - 1] as VideoClip | undefined
  const next = main.items[i + 1] as VideoClip | undefined
  let k = 1
  const tin = transitionDuration(prev, clip)
  if (tin > 0) k = Math.min(k, (t - clip.start) / tin)
  const tout = next ? transitionDuration(clip, next) : 0
  if (tout > 0) k = Math.min(k, (itemEnd(clip) - t) / tout)
  return clamp(k, 0, 1)
}

function audioFade(a: AudioItem, t: number): number {
  let k = 1
  if (a.fadeIn > 0) k = Math.min(k, (t - a.start) / a.fadeIn)
  if (a.fadeOut > 0) k = Math.min(k, (itemEnd(a) - t) / a.fadeOut)
  return clamp(k, 0, 1)
}

/**
 * Reproduce el proyecto en la vista previa. Un reloj propio marca el tiempo y cada clip con video
 * tiene su propio <video> sincronizado con él. El sonido pasa por Web Audio (volumen hasta 200 % y fundidos).
 */
export class Player implements FrameSource {
  project: Project
  time = 0
  playing = false
  onStop: (() => void) | null = null
  private audio: AudioContext | null = null
  private sounds = new Map<string, Sound>()
  private clockAt = 0
  private timeAt = 0

  constructor(project: Project) {
    this.project = project
  }

  private ctx(): AudioContext {
    return (this.audio ??= new AudioContext())
  }

  private sound(id: string, kind: 'video' | 'audio', path: string): Sound {
    let s = this.sounds.get(id)
    if (!s) {
      const el = kind === 'video' ? document.createElement('video') : new Audio()
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      if (el instanceof HTMLVideoElement) el.playsInline = true
      const source = this.ctx().createMediaElementSource(el)
      const gain = this.ctx().createGain()
      source.connect(gain).connect(this.ctx().destination)
      el.src = mediaUrl(path)
      s = { el, source, gain }
      this.sounds.set(id, s)
    }
    return s
  }

  private release(id: string): void {
    const s = this.sounds.get(id)
    if (!s) return
    s.el.pause()
    s.source.disconnect()
    s.el.removeAttribute('src')
    s.el.load()
    this.sounds.delete(id)
  }

  setProject(p: Project): void {
    this.project = p
    const ids = new Set(p.tracks.flatMap((t) => t.items.map((i) => i.id)))
    for (const id of [...this.sounds.keys()]) if (!ids.has(id)) this.release(id)
    this.time = Math.min(this.time, totalDuration(p))
  }

  seek(t: number): void {
    this.time = clamp(t, 0, totalDuration(this.project))
    this.timeAt = this.time
    this.clockAt = performance.now()
  }

  play(): void {
    const total = totalDuration(this.project)
    if (total <= 0) return
    if (this.time >= total - 0.01) this.time = 0
    void this.ctx().resume()
    this.playing = true
    this.seek(this.time)
  }

  pause(): void {
    this.playing = false
    for (const s of this.sounds.values()) s.el.pause()
  }

  tick(now: number): void {
    const total = totalDuration(this.project)
    if (this.playing) {
      // Mientras algún video que debería sonar está cargando, el reloj espera.
      if (this.waiting()) {
        this.timeAt = this.time
        this.clockAt = now
      } else {
        this.time = this.timeAt + (now - this.clockAt) / 1000
      }
      if (this.time >= total) {
        this.time = total
        this.pause()
        this.onStop?.()
      }
    }
    this.time = Math.min(this.time, total)
    this.sync()
  }

  private waiting(): boolean {
    for (const track of this.project.tracks) {
      if (track.hidden || track.kind === 'audio') continue
      for (const item of track.items) {
        if (item.type !== 'video' || this.time < item.start || this.time >= itemEnd(item)) continue
        const s = this.sounds.get(item.id)
        if (s && s.el.readyState < 3 && !s.el.ended) return true
      }
    }
    return false
  }

  private syncElement(s: Sound, target: number, rate: number, gain: number, active: boolean): void {
    const el = s.el
    s.gain.gain.value = gain
    if (Math.abs(el.playbackRate - rate) > 0.001) el.playbackRate = rate
    if (this.playing && active) {
      if (el.paused) {
        el.currentTime = target
        el.play().catch(noop)
      } else if (!el.seeking && Math.abs(el.currentTime - target) > MAX_DRIFT * rate) {
        el.currentTime = target
      }
    } else {
      if (!el.paused) el.pause()
      // En pausa el video queda en el cuadro exacto; si aún no le toca, espera en su primer cuadro.
      if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target
    }
  }

  private sync(): void {
    const p = this.project
    const t = this.time
    const used = new Set<string>()
    for (const track of p.tracks) {
      for (const item of track.items) {
        const near = t >= item.start - PRELOAD && t < itemEnd(item) + 0.5
        const far = t < item.start - RELEASE || t > itemEnd(item) + RELEASE
        if (item.type === 'video') {
          const m = findMedia(p, item.mediaId)
          if (!m || track.hidden) continue
          if (!near) {
            if (far) continue
            if (this.sounds.has(item.id)) used.add(item.id)
            this.sounds.get(item.id)?.el.pause()
            continue
          }
          used.add(item.id)
          const s = this.sound(item.id, 'video', editPath(m))
          const active = t >= item.start && t < itemEnd(item)
          const local = clamp(t - item.start, 0, item.duration)
          const vol = track.muted || !m.hasAudio ? 0 : item.volume * (track.kind === 'main' ? clipFade(p, item, t) : 1)
          this.syncElement(s, item.in + local * item.speed, item.speed, active ? vol : 0, active)
        } else if (item.type === 'audio') {
          const m = findMedia(p, item.mediaId)
          if (!m || !near) continue
          used.add(item.id)
          const s = this.sound(item.id, 'audio', m.path)
          const active = t >= item.start && t < itemEnd(item)
          this.syncElement(s, item.in + clamp(t - item.start, 0, item.duration), 1, track.muted ? 0 : item.volume * audioFade(item, t), active)
        }
      }
    }
    for (const id of [...this.sounds.keys()]) if (!used.has(id)) this.release(id)
  }

  clipFrame(clip: VideoClip, media: MediaItem): Drawable | null {
    if (clip.type === 'image') {
      const img = cachedImage(media.path)
      return img && { source: img, width: img.naturalWidth, height: img.naturalHeight }
    }
    const el = this.sounds.get(clip.id)?.el as HTMLVideoElement | undefined
    return el && el.readyState >= 2 ? { source: el, width: el.videoWidth, height: el.videoHeight } : null
  }

  draw(ctx: Ctx, W: number, H: number): Hit[] {
    return drawFrame(ctx, this.project, this.time, W, H, this)
  }

  dispose(): void {
    this.pause()
    for (const id of [...this.sounds.keys()]) this.release(id)
    void this.audio?.close()
    this.audio = null
  }
}
