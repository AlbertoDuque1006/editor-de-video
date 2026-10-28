import { mediaUrl } from '../../shared/mediaUrl'
import type { Logo, OverlayLayer, Project, TextItem } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { findMedia, totalDuration } from './util'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const FONTS = ['Arial', 'Helvetica Neue', 'Georgia', 'Impact', 'Verdana', 'Trebuchet MS', 'Courier New', 'Times New Roman']

/** Dibuja un texto en un cuadro de W x H y devuelve el rectángulo que ocupa. */
export function drawText(ctx: Ctx, t: TextItem, W: number, H: number): Box {
  const px = t.size * H
  const lines = (t.text || ' ').split('\n')
  const lineH = px * 1.2
  ctx.font = `${t.bold ? 700 : 400} ${px}px "${t.font}", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const padX = px * 0.4
  const padY = px * 0.2
  const box = { w: textW + padX * 2, h: lines.length * lineH + padY * 2, x: 0, y: 0 }
  box.x = t.x * W - box.w / 2
  box.y = t.y * H - box.h / 2

  if (t.background) {
    ctx.fillStyle = t.backgroundColor
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.w, box.h, px * 0.25)
    ctx.fill()
  }
  lines.forEach((line, i) => {
    const ly = box.y + padY + lineH * (i + 0.5)
    if (t.outline) {
      ctx.strokeStyle = '#000'
      ctx.lineWidth = px * 0.14
      ctx.lineJoin = 'round'
      ctx.strokeText(line, t.x * W, ly)
    }
    ctx.fillStyle = t.color
    ctx.fillText(line, t.x * W, ly)
  })
  return box
}

export function logoBox(logo: Logo, img: { width: number; height: number }, W: number, H: number): Box {
  const w = logo.size * W
  const h = (w * img.height) / img.width
  const m = 0.04 * Math.min(W, H)
  const x = logo.corner.endsWith('left') ? m : W - w - m
  const y = logo.corner.startsWith('top') ? m : H - h - m
  return { x, y, w, h }
}

export function drawLogo(ctx: Ctx, logo: Logo, img: CanvasImageSource & { width: number; height: number }, W: number, H: number): void {
  const b = logoBox(logo, img, W, H)
  ctx.save()
  ctx.globalAlpha = logo.opacity
  ctx.drawImage(img, b.x, b.y, b.w, b.h)
  ctx.restore()
}

const imageCache = new Map<string, HTMLImageElement>()

/** Devuelve la imagen si ya cargó; si no, la empieza a cargar y llama onLoad al terminar. */
export function cachedImage(path: string, onLoad: () => void): HTMLImageElement | null {
  let img = imageCache.get(path)
  if (!img) {
    img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = onLoad
    img.src = mediaUrl(path)
    imageCache.set(path, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`No se pudo leer la imagen ${path}`))
    img.src = mediaUrl(path)
  })
}

async function toPng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Capas transparentes a resolución final, una por texto y una para el logo. */
export async function renderOverlayLayers(project: Project): Promise<OverlayLayer[]> {
  const { width: W, height: H } = FORMATS[project.format]
  const total = totalDuration(project)
  const layers: OverlayLayer[] = []

  for (const t of project.texts) {
    const start = Math.max(0, t.start)
    const end = Math.min(total, t.end)
    if (end <= start || !t.text.trim()) continue
    const c = new OffscreenCanvas(W, H)
    drawText(c.getContext('2d')!, t, W, H)
    layers.push({ png: await toPng(c), start, end })
  }

  const logoMedia = project.logo && findMedia(project, project.logo.mediaId)
  if (project.logo && logoMedia) {
    const img = await loadImage(logoMedia.path)
    const c = new OffscreenCanvas(W, H)
    drawLogo(c.getContext('2d')!, project.logo, img, W, H)
    layers.push({ png: await toPng(c), start: 0, end: total })
  }
  return layers
}
