import { mediaUrl } from '../../shared/mediaUrl'
import type { Fit, MediaItem, Project } from '../../shared/types'
import { type Box, cachedImage, drawLogo, drawText } from './overlays'
import { clamp, findMedia, locate, totalDuration } from './util'

const FADE_SECONDS = 2
// Si el video se desfasa más que esto respecto al reloj, se corrige con un salto.
const MAX_DRIFT = 0.3

type Ctx = CanvasRenderingContext2D

interface Sound {
  el: HTMLMediaElement
  source: MediaElementAudioSourceNode
  gain: GainNode
}

export function drawFit(ctx: Ctx, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, fit: Fit): void {
  if (!sw || !sh) return
  const s = fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh)
  const w = sw * s
  const h = sh * s
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h)
}

const noop = (): void => {}

/**
 * Reproduce la secuencia en la vista previa: un reloj propio marca el tiempo y los
 * elementos <video>/<audio> (uno por archivo) se mantienen sincronizados con él.
 * El volumen pasa por Web Audio para permitir más de 100 % y el desvanecido de la música.
 */
export class Player {
  project: Project
  time = 0
  playing = false
  onStop: (() => void) | null = null
  private audio: AudioContext | null = null
  private videos = new Map<string, Sound>()
  private music: (Sound & { path: string }) | null = null
  private active: HTMLVideoElement | null = null
  private clockAt = 0
  private timeAt = 0

  constructor(project: Project) {
    this.project = project
  }

  private sound(el: HTMLMediaElement): Sound {
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    this.audio ??= new AudioContext()
    const source = this.audio.createMediaElementSource(el)
    const gain = this.audio.createGain()
    source.connect(gain).connect(this.audio.destination)
    return { el, source, gain }
  }

  private release(s: Sound): void {
    s.el.pause()
    s.source.disconnect()
    s.el.removeAttribute('src')
    s.el.load()
  }

  private video(m: MediaItem): Sound {
    let s = this.videos.get(m.id)
    if (!s) {
      const el = document.createElement('video')
      el.playsInline = true
      s = this.sound(el)
      el.src = mediaUrl(m.path)
      this.videos.set(m.id, s)
    }
    return s
  }

  setProject(p: Project): void {
    this.project = p
    for (const [id, s] of this.videos) {
      if (!p.media.some((m) => m.id === id)) {
        if (this.active === s.el) this.active = null
        this.release(s)
        this.videos.delete(id)
      }
    }
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
    this.audio ??= new AudioContext()
    void this.audio.resume()
    this.playing = true
    this.seek(this.time)
  }

  pause(): void {
    this.playing = false
    for (const s of this.videos.values()) s.el.pause()
    this.music?.el.pause()
  }

  tick(now: number): void {
    const total = totalDuration(this.project)
    if (this.playing) {
      // Mientras el video está cargando el siguiente pedazo, el reloj espera.
      if (this.active && this.active.readyState < 3) {
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
    this.syncVideo()
    this.syncMusic(total)
  }

  private syncVideo(): void {
    const loc = locate(this.project.clips, this.time)
    const clip = loc ? this.project.clips[loc.index] : null
    const media = clip ? findMedia(this.project, clip.mediaId) : undefined
    const s = media?.kind === 'video' ? this.video(media) : null
    if (this.active && this.active !== s?.el) this.active.pause()
    this.active = (s?.el as HTMLVideoElement | undefined) ?? null
    if (!s || !clip || !loc || !media) return

    const v = s.el
    const target = clip.in + loc.local
    s.gain.gain.value = media.hasAudio ? clip.volume : 0
    if (this.playing) {
      if (v.paused) {
        v.currentTime = target
        v.play().catch(noop)
      } else if (!v.seeking && Math.abs(v.currentTime - target) > MAX_DRIFT) {
        v.currentTime = target
      }
    } else {
      if (!v.paused) v.pause()
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.02) v.currentTime = target
    }
  }

  private syncMusic(total: number): void {
    const music = this.project.music
    const m = music ? findMedia(this.project, music.mediaId) : undefined
    if (!music || !m) {
      if (this.music) this.release(this.music)
      this.music = null
      return
    }
    if (!this.music || this.music.path !== m.path) {
      if (this.music) this.release(this.music)
      const el = new Audio()
      this.music = { ...this.sound(el), path: m.path }
      el.src = mediaUrl(m.path)
    }
    const el = this.music.el
    const fade = music.fadeOut && total > FADE_SECONDS ? clamp((total - this.time) / FADE_SECONDS, 0, 1) : 1
    this.music.gain.gain.value = music.volume * fade
    const audible = this.time < (el.duration || Infinity)
    if (this.playing && audible) {
      if (el.paused) {
        el.currentTime = this.time
        el.play().catch(noop)
      } else if (!el.seeking && Math.abs(el.currentTime - this.time) > MAX_DRIFT) {
        el.currentTime = this.time
      }
    } else if (!el.paused) {
      el.pause()
    }
  }

  /** Pinta el cuadro actual y devuelve dónde quedó cada texto (para poder arrastrarlos). */
  draw(ctx: Ctx, W: number, H: number): { id: string; box: Box }[] {
    const p = this.project
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    const loc = locate(p.clips, this.time)
    const clip = loc ? p.clips[loc.index] : null
    const media = clip ? findMedia(p, clip.mediaId) : undefined
    if (media?.kind === 'video') {
      const v = this.active
      if (v && v.readyState >= 2) drawFit(ctx, v, v.videoWidth, v.videoHeight, W, H, p.fit)
    } else if (media?.kind === 'image') {
      const img = cachedImage(media.path, noop)
      if (img) drawFit(ctx, img, img.naturalWidth, img.naturalHeight, W, H, p.fit)
    }

    const boxes: { id: string; box: Box }[] = []
    for (const t of p.texts) {
      if (this.time >= t.start && this.time < t.end && t.text.trim()) boxes.push({ id: t.id, box: drawText(ctx, t, W, H) })
    }
    const logoMedia = p.logo ? findMedia(p, p.logo.mediaId) : undefined
    if (p.logo && logoMedia) {
      const img = cachedImage(logoMedia.path, noop)
      if (img) drawLogo(ctx, p.logo, img, W, H)
    }
    return boxes
  }

  dispose(): void {
    this.pause()
    for (const s of this.videos.values()) this.release(s)
    this.videos.clear()
    if (this.music) this.release(this.music)
    this.music = null
    void this.audio?.close()
    this.audio = null
  }
}
