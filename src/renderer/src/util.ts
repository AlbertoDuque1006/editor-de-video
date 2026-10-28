import type { Clip, MediaItem, Project, TextItem } from '../../shared/types'

export const IMAGE_DEFAULT_SECONDS = 3
export const MIN_CLIP = 0.1

export const uid = (): string => crypto.randomUUID()

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export const clipDur = (c: Clip): number => Math.max(0, c.out - c.in)

export function clipStarts(clips: Clip[]): number[] {
  const starts: number[] = []
  let t = 0
  for (const c of clips) {
    starts.push(t)
    t += clipDur(c)
  }
  return starts
}

export const totalDuration = (p: Project): number => p.clips.reduce((s, c) => s + clipDur(c), 0)

/** Qué clip suena en el segundo t de la secuencia y en qué punto de ese clip. */
export function locate(clips: Clip[], t: number): { index: number; local: number } | null {
  let start = 0
  for (let i = 0; i < clips.length; i++) {
    const d = clipDur(clips[i])
    if (t < start + d || i === clips.length - 1) return { index: i, local: clamp(t - start, 0, d) }
    start += d
  }
  return null
}

export const findMedia = (p: Project, id: string): MediaItem | undefined => p.media.find((m) => m.id === id)

/** Límite superior de "out": la duración del archivo, o sin límite en imágenes. */
export const maxOut = (m: MediaItem | undefined): number => (m && m.kind === 'video' ? m.duration : Infinity)

export function formatTime(t: number): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

export function newClip(m: MediaItem): Clip {
  return { id: uid(), mediaId: m.id, in: 0, out: m.kind === 'image' ? IMAGE_DEFAULT_SECONDS : m.duration, volume: 1 }
}

export const emptyProject = (): Project => ({
  format: '9:16',
  fit: 'cover',
  media: [],
  clips: [],
  texts: [],
  music: null,
  logo: null
})

export type Update = (fn: (p: Project) => Project, key?: string) => void

export type Selection =
  | { kind: 'clip'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'music' }
  | { kind: 'logo' }
  | null

export const mapClip = (p: Project, id: string, fn: (c: Clip) => Clip): Project => ({
  ...p,
  clips: p.clips.map((c) => (c.id === id ? fn(c) : c))
})

export const mapText = (p: Project, id: string, fn: (t: TextItem) => TextItem): Project => ({
  ...p,
  texts: p.texts.map((t) => (t.id === id ? fn(t) : t))
})

/** Parte un clip en dos en el segundo t de la secuencia. Devuelve null si el corte queda en un borde. */
export function splitAt(p: Project, t: number): { project: Project; newId: string } | null {
  const loc = locate(p.clips, t)
  if (!loc) return null
  const c = p.clips[loc.index]
  const d = clipDur(c)
  if (loc.local < MIN_CLIP || d - loc.local < MIN_CLIP) return null
  const m = findMedia(p, c.mediaId)
  const newId = uid()
  const [a, b]: [Clip, Clip] =
    m?.kind === 'image'
      ? [{ ...c, out: loc.local }, { ...c, id: newId, in: 0, out: d - loc.local }]
      : [{ ...c, out: c.in + loc.local }, { ...c, id: newId, in: c.in + loc.local }]
  const clips = [...p.clips]
  clips.splice(loc.index, 1, a, b)
  return { project: { ...p, clips }, newId }
}

export function newText(start: number): TextItem {
  return {
    id: uid(),
    text: 'Escribe tu texto',
    start,
    end: start + 3,
    x: 0.5,
    y: 0.8,
    size: 0.055,
    color: '#ffffff',
    font: 'Arial',
    bold: true,
    outline: true,
    background: false,
    backgroundColor: '#000000aa'
  }
}

/** Mueve el elemento con id a la posición index (contada sin él). */
export function moveTo<T extends { id: string }>(items: T[], id: string, index: number): T[] {
  const item = items.find((i) => i.id === id)
  if (!item) return items
  const rest = items.filter((i) => i.id !== id)
  rest.splice(index, 0, item)
  return rest
}
