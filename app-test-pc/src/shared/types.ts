// Contrato de datos del proyecto (versión 2). Todos los tiempos van en segundos.
// Posiciones y tamaños van como fracción del cuadro (0 a 1) para que no dependan del formato.

export type MediaKind = 'video' | 'image' | 'audio'

export interface MediaItem {
  id: string
  path: string
  name: string
  kind: MediaKind
  /** Las imágenes no tienen duración propia (0). */
  duration: number
  width: number
  height: number
  hasAudio: boolean
  /** Códec de video según FFmpeg (h264, hevc, prores…). */
  codec?: string
  /** Copia H.264 para editar cuando el original no se puede leer en la vista previa. */
  proxy?: string
  /** URL media:// de la miniatura. */
  thumb?: string
}

export interface Word {
  text: string
  start: number
  end: number
}

/** Transcripción de un archivo; los tiempos son dentro del archivo, no de la línea de tiempo. */
export interface Transcript {
  mediaId: string
  language: string
  words: Word[]
}

// --- Animación ---

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'back-out' | 'bounce'
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'

export interface Keyframe {
  /** Segundos desde el inicio del elemento. */
  t: number
  v: number
  /** Curva para llegar a este keyframe desde el anterior. */
  ease: Easing
}

export type Keyframes = Partial<Record<AnimProp, Keyframe[]>>

export interface Transform {
  /** Centro del elemento. */
  x: number
  y: number
  /** 1 = tamaño normal (en clips: lo que ocupa con su encuadre). */
  scale: number
  /** Grados, en sentido horario. */
  rotation: number
  opacity: number
}

export const IN_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'pop', 'spin', 'blur', 'typewriter', 'words'] as const
export const OUT_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'pop', 'spin', 'blur'] as const
export const LOOP_ANIMS = ['none', 'ken-burns-in', 'ken-burns-out', 'pan-left', 'pan-right', 'pulse', 'float', 'shake'] as const
export type InAnim = (typeof IN_ANIMS)[number]
export type OutAnim = (typeof OUT_ANIMS)[number]
export type LoopAnim = (typeof LOOP_ANIMS)[number]

export interface Animations {
  in: { type: InAnim; duration: number }
  out: { type: OutAnim; duration: number }
  loop: LoopAnim
}

export const FILTER_PRESETS = ['none', 'bw', 'warm', 'cool', 'vintage', 'vivid', 'cinema', 'fade'] as const
export type FilterPreset = (typeof FILTER_PRESETS)[number]

export interface Filters {
  /** 1 = sin cambio. */
  brightness: number
  contrast: number
  saturation: number
  /** Desenfoque como fracción del alto del cuadro (0 = nada). */
  blur: number
  preset: FilterPreset
}

export const TRANSITIONS = ['none', 'fade', 'fade-black', 'slide-left', 'slide-right', 'slide-up', 'zoom', 'wipe-left', 'wipe-right', 'blur'] as const
export type TransitionType = (typeof TRANSITIONS)[number]

export interface Transition {
  type: TransitionType
  duration: number
}

// --- Elementos de la línea de tiempo ---

export type Fit = 'cover' | 'contain'

interface ItemBase {
  id: string
  /** Inicio en la línea de tiempo. En la pista principal lo recalcula normalizeProject. */
  start: number
  /** Lo que dura en la línea de tiempo. */
  duration: number
}

interface Visual {
  transform: Transform
  keyframes: Keyframes
  anim: Animations
}

export interface VideoClip extends ItemBase, Visual {
  type: 'video' | 'image'
  mediaId: string
  /** Punto de inicio dentro del archivo. Se usa del archivo: in .. in + duration * speed. */
  in: number
  speed: number
  /** 0 = silencio, 1 = original, hasta 2. */
  volume: number
  fit: Fit
  filters: Filters
  /** Transición desde el clip anterior (solo en la pista principal). */
  transition: Transition
}

export type TextAlign = 'left' | 'center' | 'right'

export interface TextStyle {
  font: string
  /** Alto de letra como fracción del alto del cuadro. */
  size: number
  color: string
  bold: boolean
  italic: boolean
  uppercase: boolean
  align: TextAlign
  outline: boolean
  outlineColor: string
  shadow: boolean
  background: boolean
  /** Admite transparencia (#rrggbbaa). */
  backgroundColor: string
}

export interface TextItem extends ItemBase, Visual {
  type: 'text'
  text: string
  style: TextStyle
}

export interface ShapeItem extends ItemBase, Visual {
  type: 'shape'
  shape: 'rect' | 'circle'
  /** Ancho y alto como fracción del ancho y alto del cuadro. */
  w: number
  h: number
  color: string
  /** Radio de las esquinas como fracción del lado menor. */
  radius: number
}

export const CAPTION_PRESETS = ['karaoke', 'pop', 'line', 'bounce'] as const
export type CaptionPreset = (typeof CAPTION_PRESETS)[number]

export interface CaptionsItem extends ItemBase, Visual {
  type: 'captions'
  /** Tiempos en la línea de tiempo (ya convertidos desde el archivo). */
  words: Word[]
  style: TextStyle
  preset: CaptionPreset
  /** Color de la palabra que se está diciendo. */
  highlight: string
  /** Palabras máximas por pantalla. */
  maxWords: number
}

export interface AudioItem extends ItemBase {
  type: 'audio'
  mediaId: string
  in: number
  volume: number
  fadeIn: number
  fadeOut: number
}

export type VisualItem = VideoClip | TextItem | ShapeItem | CaptionsItem
export type Item = VisualItem | AudioItem
export type ItemType = Item['type']

/** main: clips en fila, uno tras otro. overlay: elementos visuales libres encima. audio: música y sonidos. */
export type TrackKind = 'main' | 'overlay' | 'audio'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  items: Item[]
  muted: boolean
  hidden: boolean
}

export type FormatId = '9:16' | '16:9' | '1:1' | '4:5'

export const FORMATS: Record<FormatId, { label: string; width: number; height: number }> = {
  '9:16': { label: 'Vertical 9:16 (Reels, TikTok, Historias)', width: 1080, height: 1920 },
  '16:9': { label: 'Horizontal 16:9 (YouTube)', width: 1920, height: 1080 },
  '1:1': { label: 'Cuadrado 1:1', width: 1080, height: 1080 },
  '4:5': { label: 'Retrato 4:5 (Feed de Instagram)', width: 1080, height: 1350 }
}

export const FPS = 30

export interface Brand {
  font: string
  primary: string
  secondary: string
  logoMediaId: string | null
}

/** Textos para publicar el video, que puede escribir Claude. */
export interface PostCopy {
  title: string
  caption: string
  hashtags: string[]
}

export interface Project {
  version: 2
  format: FormatId
  /** Color de fondo donde no hay imagen. */
  background: string
  media: MediaItem[]
  /** De abajo hacia arriba: tracks[0] es la pista principal. */
  tracks: Track[]
  transcripts: Transcript[]
  brand: Brand
  copy: PostCopy
}

// --- Exportación ---

export interface ExportVideoDone {
  /** MP4 o WebM solo con imagen, ya renderizado por la interfaz. */
  videoPath: string
  /** true si el video viene en H.264 y se puede copiar sin volver a comprimir. */
  h264: boolean
  project: Project
  outputPath: string
}

export type ExportEvent =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; outputPath: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
