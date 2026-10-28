import type { Project, Item, VideoClip, MediaItem, Track, Transform, Animations, Filters, Transition, TextStyle, Keyframes, Word } from './types.ts'
import { IN_ANIMS, OUT_ANIMS, LOOP_ANIMS, FILTER_PRESETS, TRANSITIONS, CAPTION_PRESETS, FORMATS } from './types.ts'
import { MIN_DURATION, uid, clamp, defaultTransform, defaultAnim, defaultTextStyle, newTrack, newClip, newAudio, normalizeProject, totalDuration, mainTrack, findItem, findMedia, sourceOut } from './project.ts'
import { planKeep } from './cuts.ts'

export type Op = { op: string; [k: string]: unknown }
export interface OpsResult { project: Project; errors: string[]; created: Record<string, string> }
type R = Record<string, unknown>
const obj = (v: unknown, name: string): R => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(`${name} debe ser un objeto`); return v as R }
const str = (v: unknown, name: string): string => { if (typeof v !== 'string') throw Error(`${name} debe ser texto`); return v }
const num = (v: unknown, name: string, min = -Infinity, max = Infinity): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw Error(`${name} debe ser un número finito`); return clamp(v, min, max) }
const en = <T extends string>(v: unknown, values: readonly T[], name: string): T => { if (typeof v !== 'string' || !values.includes(v as T)) throw Error(`${name} inválido`); return v as T }
const color = (v: unknown, name: string): string => { const s = str(v, name); if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) throw Error(`${name} debe ser un color hexadecimal`); return s }
const bool = (v: unknown, name: string): boolean => { if (typeof v !== 'boolean') throw Error(`${name} debe ser booleano`); return v }
const present = (r: R, k: string) => Object.prototype.hasOwnProperty.call(r, k)
const put = (p: Project, track: Track, items: Item[]) => { const t = p.tracks.findIndex(x => x.id === track.id); p.tracks[t].items = items }
const first = (p: Project, kind: 'overlay' | 'audio'): Track => { let t = p.tracks.find(x => x.kind === kind); if (!t) { t = newTrack(kind); p.tracks.push(t) } return t }
const named = (p: Project, name: string): Track => { let t = p.tracks.find(x => x.kind === 'overlay' && x.name === name); if (!t) { t = newTrack('overlay', name); p.tracks.push(t) } return t }
const refId = (v: unknown, p: Project, refs: Record<string, string>, media = false): string => {
  let id = str(v, media ? 'mediaId' : 'id')
  if (id.startsWith('@')) { id = refs[id.slice(1)] ?? ''; if (!id) throw Error('referencia inexistente') }
  if (media ? !findMedia(p, id) : !findItem(p, id)) throw Error(media ? 'medio inexistente' : 'elemento inexistente')
  return id
}
const media = (p: Project, v: unknown, refs: Record<string, string>, kinds: string[]): MediaItem => {
  const m = findMedia(p, refId(v, p, refs, true))!
  if (!kinds.includes(m.kind)) throw Error('tipo de medio no permitido')
  return m
}
const transform = (base: Transform, v: unknown): Transform => {
  const r = obj(v, 'transform'); const a = { ...base }
  for (const k of Object.keys(r)) {
    if (k === 'x' || k === 'y') a[k] = num(r[k], k, -1, 2)
    else if (k === 'scale') a.scale = num(r[k], k, 0.05, 10)
    else if (k === 'opacity') a.opacity = num(r[k], k, 0, 1)
    else if (k === 'rotation') a.rotation = num(r[k], k)
    else throw Error(`transform.${k} desconocido`)
  }
  return a
}
const anim = (base: Animations, v: unknown): Animations => {
  const r = obj(v, 'anim'); const a = structuredClone(base)
  for (const k of Object.keys(r)) {
    if (k === 'loop') a.loop = en(r[k], LOOP_ANIMS, 'anim.loop')
    else if (k === 'in' || k === 'out') {
      const x = obj(r[k], `anim.${k}`)
      for (const f of Object.keys(x)) {
        if (f === 'type') (a[k] as {type: string}).type = en(x[f], k === 'in' ? IN_ANIMS : OUT_ANIMS, `anim.${k}.type`)
        else if (f === 'duration') a[k].duration = num(x[f], `anim.${k}.duration`, 0, 5)
        else throw Error(`anim.${k}.${f} desconocido`)
      }
    } else throw Error(`anim.${k} desconocido`)
  }
  return a
}
const keyframes = (base: Keyframes, v: unknown): Keyframes => {
  const r = obj(v, 'keyframes'); const a = structuredClone(base)
  for (const [k, value] of Object.entries(r)) {
    if (!['x','y','scale','rotation','opacity'].includes(k) || !Array.isArray(value)) throw Error(`keyframes.${k} inválido`)
    const list = value.map((raw: unknown) => { const x = obj(raw, 'keyframe'); return { t: num(x.t, 't', 0), v: num(x.v, 'v', k === 'scale' ? 0.05 : k === 'opacity' ? 0 : -Infinity, k === 'scale' ? 10 : k === 'opacity' ? 1 : Infinity), ease: en(x.ease, ['linear','ease-in','ease-out','ease-in-out','back-out','bounce'] as const, 'ease') } }).sort((x, y) => x.t - y.t)
    if (list.length) (a as R)[k] = list
    else delete (a as R)[k]
  }
  return a
}
const filters = (base: Filters, v: unknown): Filters => {
  const r = obj(v, 'filters'); const a = { ...base }
  for (const k of Object.keys(r)) {
    if (k === 'preset') a.preset = en(r[k], FILTER_PRESETS, 'filters.preset')
    else if (['brightness','contrast','saturation','blur'].includes(k)) (a as unknown as R)[k] = num(r[k], `filters.${k}`, 0)
    else throw Error(`filters.${k} desconocido`)
  }
  return a
}
const transition = (base: Transition, v: unknown): Transition => {
  const r = obj(v, 'transition'); const a = { ...base }
  for (const k of Object.keys(r)) {
    if (k === 'type') a.type = en(r[k], TRANSITIONS, 'transition.type')
    else if (k === 'duration') a.duration = num(r[k], 'transition.duration', 0, 3)
    else throw Error(`transition.${k} desconocido`)
  }
  return a
}
const style = (base: TextStyle, v: unknown): TextStyle => {
  const r = obj(v, 'style'); const a = { ...base }
  for (const k of Object.keys(r)) {
    if (k === 'size') a.size = num(r[k], 'style.size', 0.01, 0.5)
    else if (['color','outlineColor','backgroundColor'].includes(k)) (a as unknown as R)[k] = color(r[k], `style.${k}`)
    else if (k === 'align') a.align = en(r[k], ['left','center','right'] as const, 'style.align')
    else if (k === 'font') a.font = str(r[k], 'style.font')
    else if (['bold','italic','uppercase','outline','shadow','background'].includes(k)) (a as unknown as R)[k] = bool(r[k], `style.${k}`)
    else throw Error(`style.${k} desconocido`)
  }
  return a
}
const boundClip = (c: VideoClip, m: MediaItem): void => {
  c.in = num(c.in, 'in', 0)
  c.duration = num(c.duration, 'duration', MIN_DURATION)
  if (m.kind === 'video') {
    if (c.in >= m.duration) throw Error('in fuera de la duración del medio')
    c.duration = Math.min(c.duration, (m.duration - c.in) / c.speed)
    if (c.duration < MIN_DURATION - 1e-9) throw Error('no queda duración suficiente en el medio')
  }
}
const clipFields = (c: VideoClip, r: R, m: MediaItem): void => {
  for (const k of ['in','duration','start','speed','volume','fit','transform','anim','filters','transition','keyframes']) if (present(r, k)) {
    if (k === 'in') c.in = num(r[k], k, 0)
    else if (k === 'duration') c.duration = num(r[k], k, MIN_DURATION)
    else if (k === 'start') c.start = num(r[k], k, 0)
    else if (k === 'speed') c.speed = num(r[k], k, 0.25, 4)
    else if (k === 'volume') c.volume = num(r[k], k, 0, 2)
    else if (k === 'fit') c.fit = en(r[k], ['cover','contain'] as const, 'fit')
    else if (k === 'transform') c.transform = transform(c.transform, r[k])
    else if (k === 'anim') c.anim = anim(c.anim, r[k])
    else if (k === 'filters') c.filters = filters(c.filters, r[k])
    else if (k === 'transition') c.transition = transition(c.transition, r[k])
    else if (k === 'keyframes') c.keyframes = keyframes(c.keyframes, r[k])
  }
  boundClip(c, m)
}
const createClip = (p: Project, r: R, refs: Record<string, string>): VideoClip => { const m = media(p, r.mediaId, refs, ['video','image']); const c = newClip(m); clipFields(c, r, m); return c }
const register = (r: R, id: string, refs: Record<string, string>) => { if (present(r, 'ref')) { const ref = str(r.ref, 'ref'); if (!ref || present(refs, ref)) throw Error('ref vacía o duplicada'); refs[ref] = id } }
const keepPieces = (c: VideoClip, spans: {start: number; end: number}[]): VideoClip[] => spans.filter(s => (s.end - s.start) / c.speed >= MIN_DURATION - 1e-9).map((s, i) => ({ ...structuredClone(c), id: uid(), in: s.start, duration: (s.end - s.start) / c.speed, transition: i === 0 ? structuredClone(c.transition) : { type: 'none', duration: 0.5 } }))
const replace = (p: Project, track: Track, index: number, items: Item[]) => put(p, track, [...track.items.slice(0, index), ...items, ...track.items.slice(index + 1)])

export function applyOps(project: Project, ops: Op[]): OpsResult {
  let current = normalizeProject(structuredClone(project))
  const errors: string[] = []; const created: Record<string, string> = {}
  if (!Array.isArray(ops)) return { project: normalizeProject(current), errors: ['Orden 1 (desconocida): lista de órdenes inválida'], created }
  for (const [index, raw] of ops.entries()) {
    const name = raw && typeof raw.op === 'string' ? raw.op : 'desconocida'
    const prefix = `Orden ${index + 1} (${name}): `
    let p = structuredClone(current); const refs = { ...created }
    try {
      const r = obj(raw, 'orden')
      switch (name) {
        case 'set_format': p.format = en(r.format, Object.keys(FORMATS) as Project['format'][], 'format'); break
        case 'add_clip': {
          const c = createClip(p, r, refs)
          const kind = present(r, 'track') ? en(r.track, ['main','overlay'] as const, 'track') : 'main'
          const t = kind === 'main' ? mainTrack(p) : first(p, 'overlay')
          const at = present(r, 'index') ? Math.trunc(num(r.index, 'index', 0, t.items.length)) : t.items.length
          t.items.splice(kind === 'main' ? at : t.items.length, 0, c)
          register(r, c.id, refs); break
        }
        case 'replace_main': {
          if (!Array.isArray(r.clips)) throw Error('clips debe ser una lista')
          const clips = r.clips.map(x => { const v = obj(x, 'clip'); const c = createClip(p, v, refs); register(v, c.id, refs); return c })
          mainTrack(p).items = clips; break
        }
        case 'update': {
          const id = refId(r.id, p, refs); const f = findItem(p, id)!; const item = f.item
          const common = ['id','op','start','duration','transform','anim','keyframes']
          const extra = item.type === 'video' || item.type === 'image' ? ['in','speed','volume','fit','filters','transition'] : item.type === 'text' ? ['text','style'] : item.type === 'shape' ? ['shape','w','h','color','radius'] : item.type === 'captions' ? ['preset','highlight','maxWords','style'] : ['in','volume','fadeIn','fadeOut']
          const unknown = Object.keys(r).filter(k => ![...common,...extra].includes(k))
          for (const k of unknown) errors.push(prefix + `campo desconocido: ${k}`)
          if (item.type === 'video' || item.type === 'image') clipFields(item, r, media(p, item.mediaId, refs, ['video','image']))
          else {
            if (present(r, 'start')) item.start = num(r.start, 'start', 0)
            if (present(r, 'duration')) item.duration = num(r.duration, 'duration', MIN_DURATION)
            if (item.type === 'audio') {
              if (present(r, 'in')) item.in = num(r.in, 'in', 0)
              if (present(r, 'volume')) item.volume = num(r.volume, 'volume', 0, 2)
              if (present(r, 'fadeIn')) item.fadeIn = num(r.fadeIn, 'fadeIn', 0, 5)
              if (present(r, 'fadeOut')) item.fadeOut = num(r.fadeOut, 'fadeOut', 0, 5)
              const m = findMedia(p, item.mediaId); if (m && item.in + item.duration > m.duration) item.duration = Math.max(MIN_DURATION, m.duration - item.in)
            } else {
              if (present(r, 'transform')) item.transform = transform(item.transform, r.transform)
              if (present(r, 'anim')) item.anim = anim(item.anim, r.anim)
              if (present(r, 'keyframes')) item.keyframes = keyframes(item.keyframes, r.keyframes)
              if ((item.type === 'text' || item.type === 'captions') && present(r, 'style')) item.style = style(item.style, r.style)
              if (item.type === 'text' && present(r, 'text')) item.text = str(r.text, 'text')
              if (item.type === 'shape') {
                if (present(r, 'shape')) item.shape = en(r.shape, ['rect','circle'] as const, 'shape')
                if (present(r, 'w')) item.w = num(r.w, 'w', 0.01, 2)
                if (present(r, 'h')) item.h = num(r.h, 'h', 0.01, 2)
                if (present(r, 'color')) item.color = color(r.color, 'color')
                if (present(r, 'radius')) item.radius = num(r.radius, 'radius', 0, 1)
              }
              if (item.type === 'captions') {
                if (present(r, 'preset')) item.preset = en(r.preset, CAPTION_PRESETS, 'preset')
                if (present(r, 'highlight')) item.highlight = color(r.highlight, 'highlight')
                if (present(r, 'maxWords')) item.maxWords = Math.trunc(num(r.maxWords, 'maxWords', 1))
              }
            }
          }
          break
        }
        case 'remove': { const f = findItem(p, refId(r.id, p, refs))!; f.track.items.splice(f.index, 1); break }
        case 'move': {
          const f = findItem(p, refId(r.id, p, refs))!
          if (f.track.kind === 'main') { if (!present(r, 'index')) throw Error('falta index'); const at = Math.trunc(num(r.index, 'index', 0, f.track.items.length - 1)); f.track.items.splice(f.index, 1); f.track.items.splice(at, 0, f.item) }
          else { if (!present(r, 'start')) throw Error('falta start'); f.item.start = num(r.start, 'start', 0) }
          break
        }
        case 'split': {
          const f = findItem(p, refId(r.id, p, refs))!; const at = num(r.at, 'at')
          if (at - f.item.start <= MIN_DURATION || f.item.start + f.item.duration - at <= MIN_DURATION) throw Error('corte demasiado cerca del borde')
          const second = structuredClone(f.item); second.id = uid(); second.start = at; second.duration = f.item.start + f.item.duration - at; f.item.duration = at - f.item.start
          if (second.type === 'video' || second.type === 'image') { if (second.type === 'video') second.in += f.item.duration * second.speed; second.transition = { type: 'none', duration: 0.5 } }
          if (second.type === 'audio') second.in += f.item.duration
          f.track.items.splice(f.index + 1, 0, second); register(r, second.id, refs); break
        }
        case 'add_text': {
          const it: Item = { id: uid(), type: 'text', text: str(r.text, 'text'), start: num(r.start, 'start', 0), duration: num(r.duration, 'duration', MIN_DURATION), style: present(r, 'style') ? style(defaultTextStyle(p.brand), r.style) : defaultTextStyle(p.brand), transform: present(r, 'transform') ? transform({ ...defaultTransform(), y: 0.8 }, r.transform) : { ...defaultTransform(), y: 0.8 }, anim: present(r, 'anim') ? anim(defaultAnim(), r.anim) : defaultAnim(), keyframes: present(r, 'keyframes') ? keyframes({}, r.keyframes) : {} }
          first(p, 'overlay').items.push(it); register(r, it.id, refs); break
        }
        case 'add_shape': {
          const it: Item = { id: uid(), type: 'shape', shape: en(r.shape, ['rect','circle'] as const, 'shape'), start: num(r.start, 'start', 0), duration: num(r.duration, 'duration', MIN_DURATION), w: num(r.w, 'w', 0.01, 2), h: num(r.h, 'h', 0.01, 2), color: color(r.color, 'color'), radius: present(r, 'radius') ? num(r.radius, 'radius', 0, 1) : 0, transform: present(r, 'transform') ? transform(defaultTransform(), r.transform) : defaultTransform(), anim: present(r, 'anim') ? anim(defaultAnim(), r.anim) : defaultAnim(), keyframes: present(r, 'keyframes') ? keyframes({}, r.keyframes) : {} }
          first(p, 'overlay').items.push(it); register(r, it.id, refs); break
        }
        case 'add_captions': {
          const words: Word[] = []
          for (const item of mainTrack(p).items) if (item.type === 'video') {
            const transcript = p.transcripts.find(t => t.mediaId === item.mediaId)
            for (const w of transcript?.words ?? []) if (w.start >= item.in && w.start < sourceOut(item)) {
              const start = item.start + (w.start - item.in) / item.speed
              const end = Math.min(item.start + item.duration, item.start + (w.end - item.in) / item.speed)
              if (end > start) words.push({ text: w.text, start, end })
            }
          }
          if (!words.length) throw Error('No hay transcripción para generar subtítulos')
          words.sort((a,b) => a.start - b.start)
          const base = { ...defaultTextStyle(p.brand), size: 0.06, uppercase: true }
          const it: Item = { id: uid(), type: 'captions', start: 0, duration: Math.max(MIN_DURATION, totalDuration(p)), words, style: present(r, 'style') ? style(base, r.style) : base, preset: present(r, 'preset') ? en(r.preset, CAPTION_PRESETS, 'preset') : 'karaoke', highlight: present(r, 'highlight') ? color(r.highlight, 'highlight') : p.brand.secondary, maxWords: present(r, 'maxWords') ? Math.trunc(num(r.maxWords, 'maxWords', 1)) : 3, transform: present(r, 'transform') ? transform({ ...defaultTransform(), y: 0.72 }, r.transform) : { ...defaultTransform(), y: 0.72 }, anim: defaultAnim(), keyframes: {} }
          const t = named(p, 'Subtítulos'); t.items = [it]; p.tracks = [...p.tracks.filter(x => x !== t), t]; register(r, it.id, refs); break
        }
        case 'set_music': {
          const m = media(p, r.mediaId, refs, ['audio','video']); if (!m.hasAudio && m.kind === 'video') throw Error('el video no tiene audio')
          const srcIn = present(r, 'in') ? num(r.in, 'in', 0) : 0; if (srcIn >= m.duration) throw Error('in fuera del medio')
          const visualDuration = Math.max(0, ...p.tracks.flatMap(t => t.items).filter(i => i.type !== 'audio').map(i => i.start + i.duration))
          const it = newAudio(m, { in: srcIn, start: 0, duration: Math.min(visualDuration, m.duration - srcIn), volume: present(r, 'volume') ? num(r.volume, 'volume', 0, 2) : 0.6, fadeIn: present(r, 'fadeIn') ? num(r.fadeIn, 'fadeIn', 0, 5) : 0, fadeOut: present(r, 'fadeOut') ? num(r.fadeOut, 'fadeOut', 0, 5) : 2 })
          if (it.duration < MIN_DURATION) throw Error('no hay duración visual suficiente')
          first(p, 'audio').items = [it]; register(r, it.id, refs); break
        }
        case 'set_logo': {
          const m = media(p, r.mediaId, refs, ['image']); const corner = en(r.corner, ['top-left','top-right','bottom-left','bottom-right'] as const, 'corner')
          const width = present(r, 'size') ? num(r.size, 'size', 0.01, 1) : 0.18
          const frame = FORMATS[p.format]; const natural = m.width / m.height; if (!(natural > 0)) throw Error('proporción del logo inválida')
          const frameRatio = frame.width / frame.height; const baseWidth = Math.min(1, natural / frameRatio); const scale = clamp(width / baseWidth, 0.05, 10)
          const height = width * frameRatio / natural; const left = corner.endsWith('left'); const top = corner.startsWith('top')
          const c = newClip(m, { start: 0, duration: Math.max(MIN_DURATION, totalDuration(p)), fit: 'contain', transform: { x: left ? 0.04 + width / 2 : 0.96 - width / 2, y: top ? 0.04 + height / 2 : 0.96 - height / 2, scale, rotation: 0, opacity: present(r, 'opacity') ? num(r.opacity, 'opacity', 0, 1) : 1 } })
          named(p, 'Logo').items = [c]; p.brand.logoMediaId = m.id; register(r, c.id, refs); break
        }
        case 'remove_ranges': {
          const f = findItem(p, refId(r.id, p, refs))!; if (f.item.type !== 'video') throw Error('solo se permiten clips de video')
          if (!Array.isArray(r.ranges)) throw Error('ranges debe ser una lista')
          const c = f.item; const from = c.in, to = sourceOut(c)
          const ranges = r.ranges.map(x => { const v = obj(x, 'rango'); const start = num(v.start, 'start'), end = num(v.end, 'end'); if (end <= start) throw Error('rango vacío'); return { start: Math.max(from, start), end: Math.min(to, end) } }).filter(x => x.end > x.start).sort((a,b) => a.start-b.start)
          const keep: {start:number;end:number}[] = []; let cursor = from
          for (const x of ranges) { if (x.start > cursor) keep.push({ start: cursor, end: x.start }); cursor = Math.max(cursor, x.end) }
          if (cursor < to) keep.push({ start: cursor, end: to })
          replace(p, f.track, f.index, keepPieces(c, keep)); break
        }
        case 'cut_silences': {
          const t = mainTrack(p); let found = false; const result: Item[] = []
          const opts: R = {}; for (const k of ['minGap','pad']) if (present(r,k)) opts[k] = num(r[k], k, 0)
          if (present(r,'fillers')) opts.fillers = bool(r.fillers, 'fillers')
          for (const item of t.items) {
            if (item.type !== 'video') { result.push(item); continue }
            const transcript = p.transcripts.find(x => x.mediaId === item.mediaId)
            if (!transcript) { result.push(item); continue }
            found = true
            // Un clip sin voz (b-roll, ambiente) no se toca: no hay silencios que cortar.
            const spoken = transcript.words.some(w => w.end > item.in && w.start < sourceOut(item))
            result.push(...(spoken ? keepPieces(item, planKeep(transcript.words, item.in, sourceOut(item), opts)) : [item]))
          }
          if (!found) throw Error('No hay transcripción en los clips principales')
          t.items = result; break
        }
        case 'set_copy': {
          if (present(r,'title')) p.copy.title = str(r.title, 'title')
          if (present(r,'caption')) p.copy.caption = str(r.caption, 'caption')
          if (present(r,'hashtags')) { if (!Array.isArray(r.hashtags)) throw Error('hashtags debe ser una lista'); p.copy.hashtags = r.hashtags.map(x => { const s = str(x, 'hashtag'); if (!/^#?[^\s#]+$/.test(s)) throw Error('hashtag inválido'); return s.startsWith('#') ? s : `#${s}` }) }
          break
        }
        case 'set_brand': {
          if (present(r,'font')) p.brand.font = str(r.font, 'font')
          if (present(r,'primary')) p.brand.primary = color(r.primary, 'primary')
          if (present(r,'secondary')) p.brand.secondary = color(r.secondary, 'secondary')
          break
        }
        default: throw Error('operación desconocida')
      }
      current = normalizeProject(p); Object.assign(created, refs)
    } catch (e) { errors.push(prefix + (e instanceof Error ? e.message : 'orden inválida')) }
  }
  return { project: normalizeProject(current), errors, created }
}
