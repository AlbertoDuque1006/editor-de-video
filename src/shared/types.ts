export type MediaKind = 'video' | 'image' | 'audio'

export interface MediaItem {
  id: string
  path: string
  name: string
  kind: MediaKind
  /** Segundos. Las imágenes no tienen duración propia (0). */
  duration: number
  width: number
  height: number
  hasAudio: boolean
  /** URL media:// de la miniatura, si se pudo generar. */
  thumb?: string
}

export interface Clip {
  id: string
  mediaId: string
  /** Inicio y fin dentro del archivo, en segundos. En imágenes, out - in es lo que dura en pantalla. */
  in: number
  out: number
  /** 0 = silencio, 1 = original, hasta 2. */
  volume: number
}

export interface TextItem {
  id: string
  text: string
  start: number
  end: number
  /** Centro del texto, como fracción del ancho y alto del cuadro (0 a 1). */
  x: number
  y: number
  /** Alto de letra como fracción del alto del cuadro. */
  size: number
  color: string
  font: string
  bold: boolean
  outline: boolean
  background: boolean
  backgroundColor: string
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface Logo {
  mediaId: string
  corner: Corner
  /** Ancho del logo como fracción del ancho del cuadro. */
  size: number
  opacity: number
}

export interface Music {
  mediaId: string
  volume: number
  fadeOut: boolean
}

export type FormatId = '9:16' | '16:9' | '1:1' | '4:5'
export type Fit = 'cover' | 'contain'

export interface Project {
  format: FormatId
  fit: Fit
  media: MediaItem[]
  clips: Clip[]
  texts: TextItem[]
  music: Music | null
  logo: Logo | null
}

export const FORMATS: Record<FormatId, { label: string; width: number; height: number }> = {
  '9:16': { label: 'Vertical 9:16 (Reels, TikTok, Historias)', width: 1080, height: 1920 },
  '16:9': { label: 'Horizontal 16:9 (YouTube)', width: 1920, height: 1080 },
  '1:1': { label: 'Cuadrado 1:1', width: 1080, height: 1080 },
  '4:5': { label: 'Retrato 4:5 (Feed de Instagram)', width: 1080, height: 1350 }
}

export const FPS = 30

/** Capa transparente del tamaño del cuadro (texto o logo) ya dibujada por la interfaz. */
export interface OverlayLayer {
  png: Uint8Array
  start: number
  end: number
}

export interface ExportRequest {
  project: Project
  overlays: OverlayLayer[]
  outputPath: string
}

export type ExportEvent =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; outputPath: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
