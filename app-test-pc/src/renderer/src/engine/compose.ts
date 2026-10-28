import type {
  CaptionsItem,
  FilterPreset,
  Filters,
  MediaItem,
  Project,
  ShapeItem,
  TextItem,
  TextStyle,
  TransitionType,
  VideoClip,
  Word
} from '../../../shared/types'
import { clamp, findMedia, itemEnd, transitionDuration } from '../../../shared/project'
import { EASINGS, evaluate, type Evaluated } from './anim'

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface Drawable {
  source: CanvasImageSource
  width: number
  height: number
}

/** Quien entrega los cuadros: la vista previa usa <video>, la exportación decodifica cuadro a cuadro. */
export interface FrameSource {
  clipFrame(clip: VideoClip, media: MediaItem, sourceTime: number): Drawable | null
}

/** Rectángulo (sin rotación) que ocupa un elemento, en píxeles del cuadro, para seleccionarlo con el ratón. */
export interface Hit {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export const FONTS = ['Arial', 'Helvetica Neue', 'Montserrat', 'Georgia', 'Impact', 'Verdana', 'Trebuchet MS', 'Futura', 'Avenir Next', 'Courier New', 'Times New Roman']

const PRESET_FILTERS: Record<FilterPreset, string> = {
  none: '',
  bw: 'grayscale(1) contrast(1.1)',
  warm: 'sepia(0.25) saturate(1.25) hue-rotate(-8deg)',
  cool: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)',
  vintage: 'sepia(0.45) contrast(0.9) brightness(1.05) saturate(0.85)',
  vivid: 'saturate(1.5) contrast(1.1)',
  cinema: 'contrast(1.18) saturate(0.85) brightness(0.95)',
  fade: 'contrast(0.85) brightness(1.08) saturate(0.8)'
}

function filterString(f: Filters | null, blurPx: number): string {
  const parts: string[] = []
  if (f) {
    if (f.preset !== 'none') parts.push(PRESET_FILTERS[f.preset])
    if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
    if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
    if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`)
  }
  if (blurPx > 0.3) parts.push(`blur(${blurPx.toFixed(1)}px)`)
  return parts.join(' ') || 'none'
}

/** Cambios que una transición aplica sobre un clip (entrante o saliente). */
interface Mods {
  dx: number
  dy: number
  scale: number
  opacity: number
  blur: number
  /** Parte visible en x, como fracción del ancho [desde, hasta]. */
  wipe: [number, number] | null
}

const NO_MODS: Mods = { dx: 0, dy: 0, scale: 1, opacity: 1, blur: 0, wipe: null }

function transitionMods(type: TransitionType, p: number, role: 'in' | 'out', W: number, H: number): Mods {
  const q = EASINGS['ease-in-out'](clamp(p, 0, 1))
  const m: Mods = { ...NO_MODS }
  const incoming = role === 'in'
  switch (type) {
    case 'fade':
      if (incoming) m.opacity = q
      break
    case 'fade-black':
      m.opacity = incoming ? clamp(2 * q - 1, 0, 1) : clamp(1 - 2 * q, 0, 1)
      break
    case 'slide-left':
      m.dx = incoming ? (1 - q) * W : -q * W
      break
    case 'slide-right':
      m.dx = incoming ? -(1 - q) * W : q * W
      break
    case 'slide-up':
      m.dy = incoming ? (1 - q) * H : -q * H
      break
    case 'zoom':
      m.scale = incoming ? 1.25 - 0.25 * q : 1 + 0.25 * q
      m.opacity = incoming ? q : 1 - q
      break
    case 'wipe-left':
      if (incoming) m.wipe = [1 - q, 1]
      break
    case 'wipe-right':
      if (incoming) m.wipe = [0, q]
      break
    case 'blur':
      m.blur = (incoming ? 1 - q : q) * 0.03
      m.opacity = incoming ? q : 1 - q
      break
  }
  return m
}

function drawClip(ctx: Ctx, p: Project, clip: VideoClip, t: number, W: number, H: number, src: FrameSource, mods: Mods): Hit | null {
  const media = findMedia(p, clip.mediaId)
  if (!media) return null
  const local = t - clip.start
  const frame = src.clipFrame(clip, media, clip.in + local * clip.speed)
  if (!frame || !frame.width || !frame.height) return null
  const ev = evaluate(clip, local)
  const fit = clip.fit === 'cover' ? Math.max(W / frame.width, H / frame.height) : Math.min(W / frame.width, H / frame.height)
  const dw = frame.width * fit
  const dh = frame.height * fit
  const scale = ev.scale * mods.scale
  const cx = ev.x * W + mods.dx
  const cy = ev.y * H + mods.dy

  ctx.save()
  if (mods.wipe) {
    ctx.beginPath()
    ctx.rect(mods.wipe[0] * W, 0, (mods.wipe[1] - mods.wipe[0]) * W, H)
    ctx.clip()
  }
  ctx.globalAlpha = clamp(ev.opacity * mods.opacity, 0, 1)
  ctx.filter = filterString(clip.filters, (ev.blur + mods.blur + clip.filters.blur) * H)
  ctx.translate(cx, cy)
  ctx.rotate((ev.rotation * Math.PI) / 180)
  ctx.scale(scale, scale)
  ctx.drawImage(frame.source, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()
  return { id: clip.id, x: cx - (dw * scale) / 2, y: cy - (dh * scale) / 2, w: dw * scale, h: dh * scale }
}

// --- Texto ---

const fontOf = (s: TextStyle, px: number) => `${s.italic ? 'italic ' : ''}${s.bold ? 700 : 400} ${px}px "${s.font}", sans-serif`

/** Parte el texto en líneas que quepan en maxW (respeta los saltos de línea escritos). */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}

function applyTextLook(ctx: Ctx, s: TextStyle, px: number): void {
  ctx.font = fontOf(s, px)
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  if (s.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = px * 0.25
    ctx.shadowOffsetY = px * 0.06
  }
}

function drawTextRun(ctx: Ctx, s: TextStyle, text: string, x: number, y: number, px: number, color: string): void {
  if (s.outline) {
    ctx.save()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = s.outlineColor
    ctx.lineWidth = px * 0.14
    ctx.strokeText(text, x, y)
    ctx.restore()
  }
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function backgroundBox(ctx: Ctx, s: TextStyle, x: number, y: number, w: number, h: number, px: number): void {
  if (!s.background) return
  ctx.save()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = s.backgroundColor
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, px * 0.25)
  ctx.fill()
  ctx.restore()
}

/** Prepara el lienzo con la posición, giro, escala y opacidad del elemento; el dibujo va centrado en (0, 0). */
function enter(ctx: Ctx, ev: Evaluated, W: number, H: number): void {
  ctx.globalAlpha = clamp(ev.opacity, 0, 1)
  if (ev.blur > 0) ctx.filter = `blur(${(ev.blur * H).toFixed(1)}px)`
  ctx.translate(ev.x * W, ev.y * H)
  ctx.rotate((ev.rotation * Math.PI) / 180)
  ctx.scale(ev.scale, ev.scale)
}

function hitFrom(id: string, ev: Evaluated, w: number, h: number, W: number, H: number): Hit {
  return { id, x: ev.x * W - (w * ev.scale) / 2, y: ev.y * H - (h * ev.scale) / 2, w: w * ev.scale, h: h * ev.scale }
}

function drawTextItem(ctx: Ctx, item: TextItem, t: number, W: number, H: number): Hit | null {
  const local = t - item.start
  const ev = evaluate(item, local)
  const s = item.style
  const px = s.size * H
  const text = s.uppercase ? item.text.toUpperCase() : item.text
  if (!text.trim()) return null

  ctx.save()
  applyTextLook(ctx, s, px)
  const lines = wrap(ctx, text, (0.9 * W) / Math.max(ev.scale, 0.05))
  const lineH = px * 1.2
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const padX = px * 0.4
  const padY = px * 0.2
  const boxW = textW + padX * 2
  const boxH = lines.length * lineH + padY * 2

  // Máquina de escribir / palabra por palabra: se recorta lo que aún no aparece.
  let visible = lines
  if (ev.revealMode === 'chars') {
    let left = Math.floor(text.replace(/\n/g, '').length * ev.reveal)
    visible = lines.map((l) => {
      const part = l.slice(0, Math.max(0, left))
      left -= l.length
      return part
    })
  } else if (ev.revealMode === 'words') {
    let left = Math.ceil(lines.join(' ').split(/\s+/).length * ev.reveal)
    visible = lines.map((l) => {
      const words = l.split(/\s+/)
      const part = words.slice(0, Math.max(0, left)).join(' ')
      left -= words.length
      return part
    })
  }

  enter(ctx, ev, W, H)
  backgroundBox(ctx, s, -boxW / 2, -boxH / 2, boxW, boxH, px)
  ctx.textAlign = s.align
  const x = s.align === 'left' ? -textW / 2 : s.align === 'right' ? textW / 2 : 0
  visible.forEach((line, i) => {
    if (line) drawTextRun(ctx, s, line, x, -boxH / 2 + padY + lineH * (i + 0.5), px, s.color)
  })
  ctx.restore()
  return hitFrom(item.id, ev, boxW, boxH, W, H)
}

function drawShape(ctx: Ctx, item: ShapeItem, t: number, W: number, H: number): Hit {
  const ev = evaluate(item, t - item.start)
  const w = item.w * W
  const h = item.h * H
  ctx.save()
  enter(ctx, ev, W, H)
  ctx.fillStyle = item.color
  ctx.beginPath()
  if (item.shape === 'circle') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
  else ctx.roundRect(-w / 2, -h / 2, w, h, item.radius * Math.min(w, h))
  ctx.fill()
  ctx.restore()
  return hitFrom(item.id, ev, w, h, W, H)
}

// --- Subtítulos ---

/** Agrupa palabras en pantallas: corta por cantidad, por pausas largas o al final de una frase. */
export function captionPages(words: Word[], maxWords: number): Word[][] {
  const pages: Word[][] = []
  let page: Word[] = []
  for (const w of words) {
    const prev = page[page.length - 1]
    if (page.length && (page.length >= maxWords || w.start - prev.end > 0.8 || /[.?!]$/.test(prev.text))) {
      pages.push(page)
      page = []
    }
    page.push(w)
  }
  if (page.length) pages.push(page)
  return pages
}

function drawCaptions(ctx: Ctx, item: CaptionsItem, t: number, W: number, H: number): Hit | null {
  const pages = captionPages(item.words, Math.max(1, item.maxWords))
  // La pantalla sigue visible hasta que empieza la siguiente (como mucho 0.5 s después de la última palabra).
  const idx = pages.findIndex((pg, i) => {
    const next = pages[i + 1]
    const end = Math.min(next ? next.at(0)!.start : Infinity, pg.at(-1)!.end + 0.5)
    return t >= pg[0].start && t < end
  })
  if (idx < 0) return null
  const page = pages[idx]
  const current = page.findLastIndex((w) => t >= w.start)
  const s = item.style
  const px = s.size * H
  const ev = evaluate(item, t - item.start)

  ctx.save()
  applyTextLook(ctx, s, px)
  const shown = item.preset === 'pop' ? [page[Math.max(0, current)]] : page
  const texts = shown.map((w) => {
    const clean = w.text.trim()
    return s.uppercase ? clean.toUpperCase() : clean
  })
  const space = ctx.measureText(' ').width
  const widths = texts.map((x) => ctx.measureText(x).width)

  // Reparte las palabras en líneas que quepan en el 86 % del ancho.
  const maxW = 0.86 * W
  const lines: number[][] = [[]]
  let lw = 0
  widths.forEach((w, i) => {
    const line = lines[lines.length - 1]
    if (line.length && lw + space + w > maxW) {
      lines.push([i])
      lw = w
    } else {
      line.push(i)
      lw += (line.length > 1 ? space : 0) + w
    }
  })
  const lineH = px * 1.25
  const lineWidths = lines.map((l) => l.reduce((a, i, k) => a + widths[i] + (k ? space : 0), 0))
  const boxW = Math.max(...lineWidths) + px * 0.8
  const boxH = lines.length * lineH + px * 0.4

  enter(ctx, ev, W, H)
  backgroundBox(ctx, s, -boxW / 2, -boxH / 2, boxW, boxH, px)
  ctx.textAlign = 'left'
  lines.forEach((line, li) => {
    let x = -lineWidths[li] / 2
    const y = -boxH / 2 + px * 0.2 + lineH * (li + 0.5)
    for (const i of line) {
      const wordIndex = item.preset === 'pop' ? current : i
      const active = wordIndex === current
      const color = active && item.preset !== 'line' ? item.highlight : s.color
      let k = 1
      if (item.preset === 'pop') k = Math.max(0.01, EASINGS['back-out'](clamp((t - page[Math.max(0, current)].start) / 0.15, 0, 1)))
      else if (item.preset === 'bounce' && active) k = 1.15
      ctx.save()
      ctx.translate(x + widths[i] / 2, y)
      ctx.scale(k, k)
      drawTextRun(ctx, s, texts[i], -widths[i] / 2, 0, px, color)
      ctx.restore()
      x += widths[i] + space
    }
  })
  ctx.restore()
  return hitFrom(item.id, ev, boxW, boxH, W, H)
}

/**
 * Pinta el cuadro del segundo t: pistas de abajo hacia arriba, con las transiciones de la pista principal.
 * Devuelve el área de cada elemento visible (de arriba hacia abajo) para poder seleccionarlo.
 */
export function drawFrame(ctx: Ctx, p: Project, t: number, W: number, H: number, src: FrameSource): Hit[] {
  ctx.save()
  ctx.fillStyle = p.background
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  const hits: Hit[] = []

  for (const track of p.tracks) {
    if (track.hidden || track.kind === 'audio') continue
    const items = track.items
    items.forEach((item, i) => {
      if (t < item.start || t >= itemEnd(item)) return
      let hit: Hit | null = null
      if (item.type === 'video' || item.type === 'image') {
        let mods = NO_MODS
        if (track.kind === 'main') {
          const prev = items[i - 1] as VideoClip | undefined
          const next = items[i + 1] as VideoClip | undefined
          const tin = transitionDuration(prev, item)
          const tout = next ? transitionDuration(item, next) : 0
          if (tin > 0 && t - item.start < tin) mods = transitionMods(item.transition.type, (t - item.start) / tin, 'in', W, H)
          else if (next && tout > 0 && t >= next.start) mods = transitionMods(next.transition.type, (t - next.start) / tout, 'out', W, H)
        }
        hit = drawClip(ctx, p, item, t, W, H, src, mods)
      } else if (item.type === 'text') hit = drawTextItem(ctx, item, t, W, H)
      else if (item.type === 'shape') hit = drawShape(ctx, item, t, W, H)
      else if (item.type === 'captions') hit = drawCaptions(ctx, item, t, W, H)
      if (hit) hits.unshift(hit)
    })
  }
  return hits
}

/** Momentos en que cada clip necesita un cuadro (para preparar la exportación). */
export function clipNeeds(clip: VideoClip, t: number): number | null {
  return t >= clip.start && t < itemEnd(clip) ? clip.in + (t - clip.start) * clip.speed : null
}
