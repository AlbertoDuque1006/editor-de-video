import type {
  Animations,
  AudioItem,
  Brand,
  Filters,
  Item,
  MediaItem,
  Project,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  Transition,
  VideoClip
} from './types.ts'

export const IMAGE_DEFAULT_SECONDS = 3
export const MIN_DURATION = 0.1

export const uid = (): string => globalThis.crypto.randomUUID()
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export const defaultTransform = (): Transform => ({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 })
export const defaultAnim = (): Animations => ({ in: { type: 'none', duration: 0.5 }, out: { type: 'none', duration: 0.5 }, loop: 'none' })
export const defaultFilters = (): Filters => ({ brightness: 1, contrast: 1, saturation: 1, blur: 0, preset: 'none' })
export const noTransition = (): Transition => ({ type: 'none', duration: 0.5 })

export const defaultBrand = (): Brand => ({ font: 'Arial', primary: '#ffffff', secondary: '#ffd400', logoMediaId: null })

export function defaultTextStyle(brand: Brand = defaultBrand()): TextStyle {
  return {
    font: brand.font,
    size: 0.055,
    color: brand.primary,
    bold: true,
    italic: false,
    uppercase: false,
    align: 'center',
    outline: true,
    outlineColor: '#000000',
    shadow: false,
    background: false,
    backgroundColor: '#000000aa'
  }
}

export function newTrack(kind: TrackKind, name?: string): Track {
  const names = { main: 'Video principal', overlay: 'Capa', audio: 'Audio' }
  return { id: uid(), kind, name: name ?? names[kind], items: [], muted: false, hidden: false }
}

export function emptyProject(): Project {
  return {
    version: 2,
    format: '9:16',
    background: '#000000',
    media: [],
    tracks: [newTrack('main'), newTrack('overlay', 'Textos y capas'), newTrack('audio', 'Música')],
    transcripts: [],
    brand: defaultBrand(),
    copy: { title: '', caption: '', hashtags: [] }
  }
}

export function newClip(m: MediaItem, opts: Partial<VideoClip> = {}): VideoClip {
  return {
    id: uid(),
    type: m.kind === 'image' ? 'image' : 'video',
    mediaId: m.id,
    start: 0,
    in: 0,
    duration: m.kind === 'image' ? IMAGE_DEFAULT_SECONDS : m.duration,
    speed: 1,
    volume: 1,
    fit: 'cover',
    transform: defaultTransform(),
    keyframes: {},
    anim: defaultAnim(),
    filters: defaultFilters(),
    transition: noTransition(),
    ...opts
  }
}

export function newAudio(m: MediaItem, opts: Partial<AudioItem> = {}): AudioItem {
  return { id: uid(), type: 'audio', mediaId: m.id, start: 0, in: 0, duration: m.duration, volume: 0.6, fadeIn: 0, fadeOut: 2, ...opts }
}

export const itemEnd = (i: Item): number => i.start + i.duration
export const mainTrack = (p: Project): Track => p.tracks.find((t) => t.kind === 'main')!
export const findMedia = (p: Project, id: string): MediaItem | undefined => p.media.find((m) => m.id === id)

/** Parte del archivo que usa un clip: de in a in + duration * speed. */
export const sourceOut = (c: VideoClip | AudioItem): number => c.in + c.duration * ('speed' in c ? c.speed : 1)

/** Duración real de una transición: no puede comerse más de la mitad de ninguno de los dos clips. */
export function transitionDuration(prev: VideoClip | undefined, clip: VideoClip): number {
  if (!prev || clip.transition.type === 'none') return 0
  return clamp(clip.transition.duration, 0, Math.min(prev.duration, clip.duration) / 2)
}

/**
 * Deja el proyecto coherente: los clips de la pista principal quedan en fila (solapados lo que dure
 * cada transición) y nada empieza antes de 0. Devuelve el mismo objeto si no hubo que cambiar nada.
 */
export function normalizeProject(p: Project): Project {
  let changed = false
  const tracks = p.tracks.map((track) => {
    let t = 0
    let prev: VideoClip | undefined
    const items = track.items.map((item) => {
      let start = Math.max(0, item.start)
      if (track.kind === 'main' && (item.type === 'video' || item.type === 'image')) {
        start = Math.max(0, t - transitionDuration(prev, item))
        t = start + item.duration
        prev = item
      }
      if (start === item.start) return item
      changed = true
      return { ...item, start }
    })
    return items.some((it, i) => it !== track.items[i]) ? { ...track, items } : track
  })
  return changed ? { ...p, tracks } : p
}

/** Duración del video: hasta donde termina lo último que se ve (o el audio, si no hay imagen). */
export function totalDuration(p: Project): number {
  let visual = 0
  let audio = 0
  for (const track of p.tracks) {
    for (const item of track.items) {
      if (item.type === 'audio') audio = Math.max(audio, itemEnd(item))
      else visual = Math.max(visual, itemEnd(item))
    }
  }
  return visual > 0 ? visual : audio
}

export function findItem(p: Project, id: string): { item: Item; track: Track; index: number } | null {
  for (const track of p.tracks) {
    const index = track.items.findIndex((i) => i.id === id)
    if (index >= 0) return { item: track.items[index], track, index }
  }
  return null
}

/** Reemplaza un elemento por id en cualquier pista. */
export function mapItem<T extends Item>(p: Project, id: string, fn: (item: T) => Item): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.items.some((i) => i.id === id) ? { ...t, items: t.items.map((i) => (i.id === id ? fn(i as T) : i)) } : t))
  }
}

export function removeItem(p: Project, id: string): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.items.some((i) => i.id === id) ? { ...t, items: t.items.filter((i) => i.id !== id) } : t)) }
}
