import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Item, Project } from '../shared/types'
import { FORMATS } from '../shared/types'
import { defaultAnim, defaultFilters, defaultTextStyle, defaultTransform, emptyProject, noTransition, normalizeProject } from '../shared/project'
import { UUID_RE } from './env'
import { probe } from './media'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const ITEM_TYPES = new Set(['video', 'image', 'text', 'shape', 'captions', 'audio'])
const TRACK_KINDS = new Set(['main', 'overlay', 'audio'])

const merge = <T extends object>(base: T, v: unknown): T => (isObj(v) ? { ...base, ...v } : base)

/** Completa los campos que falten para que un elemento mal formado no rompa la interfaz. */
function withDefaults(it: Record<string, unknown>): Item {
  const out: Record<string, unknown> = { ...it }
  if (it.type !== 'audio') {
    out.transform = merge(defaultTransform(), it.transform)
    out.anim = merge(defaultAnim(), it.anim)
    out.keyframes = isObj(it.keyframes) ? it.keyframes : {}
  }
  if (it.type === 'video' || it.type === 'image') {
    out.filters = merge(defaultFilters(), it.filters)
    out.transition = merge(noTransition(), it.transition)
    for (const [k, d] of [['in', 0], ['speed', 1], ['volume', 1]] as const) if (typeof it[k] !== 'number') out[k] = d
    if (it.fit !== 'contain') out.fit = 'cover'
  }
  if (it.type === 'text' || it.type === 'captions') out.style = merge(defaultTextStyle(), it.style)
  if (it.type === 'text' && typeof it.text !== 'string') out.text = ''
  if (it.type === 'captions' && !Array.isArray(it.words)) out.words = []
  return out as unknown as Item
}

/**
 * Revisa un proyecto abierto desde un archivo (puede venir de otra persona): estructura, tipos, ids y rutas.
 * Los medios se vuelven a leer del disco; los que no existen se informan aparte.
 */
export async function loadProjectData(raw: unknown): Promise<{ project: Project; missing: string[] }> {
  if (!isObj(raw) || raw.version !== 2 || !isObj(raw.project)) throw new Error('El archivo no es un proyecto válido de esta versión.')
  const p = raw.project
  const base = emptyProject()
  if (!Array.isArray(p.media) || !Array.isArray(p.tracks)) throw new Error('El proyecto está dañado.')

  const idMap = new Map<string, string>()
  const safeId = (id: unknown): string => {
    const s = typeof id === 'string' ? id : ''
    if (!idMap.has(s)) idMap.set(s, UUID_RE.test(s) ? s : randomUUID())
    return idMap.get(s)!
  }

  const missing: string[] = []
  const media = []
  for (const m of p.media) {
    if (!isObj(m) || typeof m.path !== 'string' || !isAbsolute(m.path)) continue
    if (!existsSync(m.path)) {
      missing.push(typeof m.name === 'string' ? m.name : m.path)
      continue
    }
    const fresh = await probe(m.path, safeId(m.id)).catch(() => null)
    if (fresh) media.push(fresh)
  }
  const mediaIds = new Set(media.map((m) => m.id))

  const tracks = []
  for (const t of p.tracks) {
    if (!isObj(t) || !TRACK_KINDS.has(String(t.kind)) || !Array.isArray(t.items)) continue
    const items: Item[] = []
    for (const it of t.items) {
      if (!isObj(it) || !ITEM_TYPES.has(String(it.type)) || typeof it.start !== 'number' || typeof it.duration !== 'number') continue
      if ('mediaId' in it) {
        const mid = safeId(it.mediaId)
        if (!mediaIds.has(mid)) continue
        it.mediaId = mid
      }
      items.push(withDefaults({ ...it, id: safeId(it.id) }))
    }
    tracks.push({ id: safeId(t.id), kind: t.kind as Project['tracks'][number]['kind'], name: String(t.name ?? ''), items, muted: !!t.muted, hidden: !!t.hidden })
  }
  if (!tracks.some((t) => t.kind === 'main')) tracks.unshift(base.tracks[0])
  // La pista principal siempre va primero.
  tracks.sort((a, b) => Number(b.kind === 'main') - Number(a.kind === 'main'))

  const transcripts = Array.isArray(p.transcripts)
    ? p.transcripts.filter((tr): tr is Project['transcripts'][number] => isObj(tr) && Array.isArray(tr.words)).map((tr) => ({ ...tr, mediaId: safeId(tr.mediaId) })).filter((tr) => mediaIds.has(tr.mediaId))
    : []

  const project: Project = {
    ...base,
    format: typeof p.format === 'string' && p.format in FORMATS ? (p.format as Project['format']) : base.format,
    background: typeof p.background === 'string' && /^#[0-9a-f]{3,8}$/i.test(p.background) ? p.background : base.background,
    media,
    tracks,
    transcripts,
    brand: isObj(p.brand) ? { ...base.brand, ...(p.brand as object), logoMediaId: null } : base.brand,
    copy: isObj(p.copy) ? { ...base.copy, ...(p.copy as object) } : base.copy
  }
  return { project: normalizeProject(project), missing }
}
