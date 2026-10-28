import { useEffect, useRef, useState } from 'react'
import type { Item, Project, Track, TrackKind, VideoClip, VisualItem } from '../../shared/types'
import { clamp, findItem, findMedia, itemEnd, mapItem, MIN_DURATION, newTrack, totalDuration } from '../../shared/project'
import { drag, formatTime, type Selection, type Update } from './util'

interface Props {
  project: Project
  time: number
  playing: boolean
  sel: Selection
  pps: number
  onZoom: (pps: number) => void
  onSelect: (s: Selection) => void
  onSeek: (t: number) => void
  update: Update
  onDropMedia: (mediaId: string, trackId: string, time: number) => void
  onAddText: () => void
  onSplit: () => void
  onDelete: () => void
}

const ROW = 30
const HEIGHTS: Record<TrackKind, number> = { main: 66, overlay: ROW, audio: 38 }

/** Reparte los elementos de una pista en filas para que no se tapen. */
function rows(items: Item[]): Map<string, number> {
  const ends: number[] = []
  const out = new Map<string, number>()
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let r = ends.findIndex((end) => end <= it.start + 1e-6)
    if (r < 0) r = ends.push(0) - 1
    ends[r] = itemEnd(it)
    out.set(it.id, r)
  }
  return out
}

function tickStep(pps: number): number {
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) ?? 300
}

function label(p: Project, it: Item): string {
  if (it.type === 'text') return it.text.split('\n')[0] || '(texto vacío)'
  if (it.type === 'shape') return it.shape === 'circle' ? '● Círculo' : '■ Rectángulo'
  if (it.type === 'captions') return `Subtítulos · ${it.words.length} palabras`
  const name = findMedia(p, it.mediaId)?.name ?? 'Archivo no encontrado'
  return it.type === 'audio' ? `♪ ${name}` : name
}

/** Límite de duración por el archivo (las fotos, textos y formas no tienen límite). */
function maxDuration(p: Project, it: Item): number {
  if (it.type !== 'video' && it.type !== 'audio') return Infinity
  const m = findMedia(p, it.mediaId)
  if (!m) return Infinity
  return (m.duration - it.in) / (it.type === 'video' ? it.speed : 1)
}

export function Timeline(props: Props) {
  const { project, time, playing, sel, pps, onZoom, onSelect, onSeek, update } = props
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [reorder, setReorder] = useState<{ id: string; index: number } | null>(null)

  const total = totalDuration(project)
  const width = Math.max(total + 8, 20) * pps
  const xToTime = (clientX: number) => Math.max(0, (clientX - contentRef.current!.getBoundingClientRect().left) / pps)

  // Durante la reproducción, la vista sigue al cursor.
  useEffect(() => {
    const s = scrollRef.current
    if (!s || !playing) return
    const x = time * pps
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = x - 40
  }, [time, playing, pps])

  const scrub = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return
    onSelect(null)
    onSeek(xToTime(e.clientX))
    drag(e, (_dx, _dy, ev) => onSeek(xToTime(ev.clientX)))
  }

  // Imán: bordes de otros elementos, el cursor y el inicio.
  const snapper = (selfId: string) => {
    const edges = [0, time]
    for (const t of project.tracks) for (const it of t.items) if (it.id !== selfId) edges.push(it.start, itemEnd(it))
    return (t: number) => {
      const near = edges.find((e) => Math.abs(e - t) * pps < 8)
      return near ?? t
    }
  }

  const selectAndPark = (it: Item) => {
    onSelect(it.id)
    if (time < it.start || time >= itemEnd(it)) onSeek(it.start)
  }

  // --- Pista principal: reordenar ---
  const startReorder = (e: React.PointerEvent, track: Track, it: Item) => {
    onSelect(it.id)
    const others = track.items.filter((o) => o.id !== it.id)
    let drop: number | null = null
    drag(
      e,
      (_dx, _dy, ev) => {
        const t = xToTime(ev.clientX)
        let acc = 0
        let index = 0
        for (; index < others.length; index++) {
          if (t < acc + others[index].duration / 2) break
          acc += others[index].duration
        }
        drop = index
        setReorder({ id: it.id, index })
      },
      (moved) => {
        setReorder(null)
        if (moved && drop !== null) {
          const index = drop
          update((p) => ({
            ...p,
            tracks: p.tracks.map((t) => {
              if (t.id !== track.id) return t
              const rest = t.items.filter((o) => o.id !== it.id)
              rest.splice(index, 0, t.items.find((o) => o.id === it.id)!)
              return { ...t, items: rest }
            })
          }))
        } else if (!moved) selectAndPark(it)
      }
    )
  }

  // --- Otras pistas: mover en el tiempo ---
  const startMove = (e: React.PointerEvent, it0: Item) => {
    onSelect(it0.id)
    const snap = snapper(it0.id)
    drag(
      e,
      (dx) => {
        let start = Math.max(0, it0.start + dx / pps)
        const s1 = snap(start)
        const s2 = snap(start + it0.duration) - it0.duration
        start = s1 !== start ? s1 : s2 !== start ? Math.max(0, s2) : start
        update((p) => mapItem(p, it0.id, (it) => ({ ...it, start })), `mover-${it0.id}`)
      },
      (moved) => !moved && selectAndPark(it0)
    )
  }

  const startTrim = (e: React.PointerEvent, track: Track, it0: Item, side: 'left' | 'right') => {
    e.stopPropagation()
    onSelect(it0.id)
    const snap = snapper(it0.id)
    const max = maxDuration(project, it0)
    const hasSource = it0.type === 'video' || it0.type === 'audio'
    const rate = it0.type === 'video' ? it0.speed : 1
    drag(e, (dx) => {
      const d = dx / pps
      update(
        (p) =>
          mapItem(p, it0.id, (it) => {
            if (side === 'right') {
              const end = track.kind === 'main' ? it0.start + it0.duration + d : snap(itemEnd(it0) + d)
              return { ...it, duration: clamp(end - it0.start, MIN_DURATION, max) }
            }
            // Borde izquierdo: en la principal recorta el inicio del archivo; en las demás además corre el inicio.
            let shift = d
            if (track.kind !== 'main') shift = snap(it0.start + d) - it0.start
            shift = clamp(shift, hasSource ? -it0.in / rate : -Infinity, it0.duration - MIN_DURATION)
            if (track.kind !== 'main') shift = Math.max(shift, -it0.start)
            const next: Item = { ...it, duration: it0.duration - shift }
            if (hasSource) (next as VideoClip).in = it0.in + shift * rate
            if (track.kind !== 'main') next.start = it0.start + shift
            return next
          }),
        `recorte-${it0.id}`
      )
    })
  }

  // --- Archivos arrastrados desde el panel ---
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-media-id')) e.preventDefault()
  }
  const onDrop = (e: React.DragEvent, track: Track) => {
    const id = e.dataTransfer.getData('application/x-media-id')
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    props.onDropMedia(id, track.id, xToTime(e.clientX))
  }

  const toggle = (trackId: string, key: 'muted' | 'hidden') =>
    update((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, [key]: !t[key] } : t)) }))

  const addTrack = (kind: TrackKind) =>
    update((p) => {
      const t = newTrack(kind)
      // Las capas nuevas van encima de las demás capas; el audio, al final.
      const tracks = [...p.tracks]
      const lastVisual = tracks.map((x) => x.kind).lastIndexOf('overlay')
      if (kind === 'overlay') tracks.splice(Math.max(1, lastVisual + 1), 0, t)
      else tracks.push(t)
      return { ...p, tracks }
    })

  const removeTrack = (id: string) => update((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) }))

  const step = tickStep(pps)
  const ticks: number[] = []
  for (let t = 0; t * pps <= width; t += step) ticks.push(t)

  // Las capas se muestran arriba (como se ven en el cuadro); el audio, abajo.
  const ordered = [
    ...project.tracks.filter((t) => t.kind === 'overlay').reverse(),
    ...project.tracks.filter((t) => t.kind === 'main'),
    ...project.tracks.filter((t) => t.kind === 'audio')
  ]
  const layout = ordered.map((track) => {
    const r = track.kind === 'main' ? new Map<string, number>() : rows(track.items)
    const n = Math.max(1, ...[...r.values()].map((x) => x + 1))
    return { track, rows: r, height: track.kind === 'main' ? HEIGHTS.main : n * HEIGHTS[track.kind] + 6 }
  })

  const selected = sel ? findItem(project, sel) : null
  const canSplit = !!selected && time > selected.item.start + MIN_DURATION && time < itemEnd(selected.item) - MIN_DURATION

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <button onClick={props.onAddText}>+ Texto</button>
        <button onClick={() => addTrack('overlay')} title="Una capa más para textos, fotos o videos encima">
          + Capa
        </button>
        <button onClick={() => addTrack('audio')}>+ Pista de audio</button>
        <span className="sep" />
        <button onClick={props.onSplit} disabled={!canSplit} title="Dividir lo seleccionado en el cursor (S)">
          ✂ Dividir
        </button>
        <button onClick={props.onDelete} disabled={!sel} title="Eliminar lo seleccionado (Supr)">
          Eliminar
        </button>
        <span className="spacer" />
        <span className="muted">Duración {formatTime(total)}</span>
        <label className="zoom">
          <span className="muted">Zoom</span>
          <input type="range" min={8} max={300} value={pps} onChange={(e) => onZoom(Number(e.target.value))} />
        </label>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <div className="ruler" />
          {layout.map(({ track, height }) => (
            <div key={track.id} className={`lane-label ${track.kind}`} style={{ height }}>
              <span className="lane-name" title={track.name}>
                {track.name}
              </span>
              <span className="lane-tools">
                {track.kind !== 'audio' && (
                  <button className={`mini ${track.hidden ? 'on' : ''}`} title={track.hidden ? 'Mostrar' : 'Ocultar'} onClick={() => toggle(track.id, 'hidden')}>
                    {track.hidden ? '◌' : '◉'}
                  </button>
                )}
                {track.kind !== 'overlay' || track.items.some((i) => i.type === 'video') ? (
                  <button className={`mini ${track.muted ? 'on' : ''}`} title={track.muted ? 'Activar sonido' : 'Silenciar'} onClick={() => toggle(track.id, 'muted')}>
                    {track.muted ? '🔇' : '🔊'}
                  </button>
                ) : null}
                {track.kind !== 'main' && track.items.length === 0 && (
                  <button className="mini" title="Quitar pista" onClick={() => removeTrack(track.id)}>
                    ×
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-content" ref={contentRef} style={{ width }}>
            <div className="ruler" onPointerDown={scrub}>
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: t * pps }}>
                  {formatTime(t).replace(/\.0$/, '')}
                </span>
              ))}
            </div>

            {layout.map(({ track, rows: r, height }) => {
              let items = track.items
              // Mientras se reordena, la pista principal muestra el orden nuevo.
              let starts = items.map((i) => i.start)
              if (track.kind === 'main' && reorder) {
                const rest = items.filter((i) => i.id !== reorder.id)
                rest.splice(reorder.index, 0, items.find((i) => i.id === reorder.id)!)
                items = rest
                let acc = 0
                starts = items.map((i) => {
                  const s = acc
                  acc += i.duration
                  return s
                })
              }
              return (
                <div
                  key={track.id}
                  className={`lane ${track.kind} ${track.hidden ? 'hidden' : ''}`}
                  style={{ height }}
                  onPointerDown={scrub}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, track)}
                >
                  {items.map((it, i) => {
                    const m = 'mediaId' in it ? findMedia(project, it.mediaId) : undefined
                    const isMain = track.kind === 'main'
                    const top = isMain ? 6 : 3 + (r.get(it.id) ?? 0) * HEIGHTS[track.kind]
                    const h = isMain ? height - 12 : HEIGHTS[track.kind] - 4
                    const visual = it.type !== 'audio' ? (it as VisualItem) : null
                    const kfTimes = visual && sel === it.id ? [...new Set(Object.values(visual.keyframes).flatMap((k) => k?.map((x) => x.t) ?? []))] : []
                    return (
                      <div
                        key={it.id}
                        className={`item ${it.type} ${sel === it.id ? 'selected' : ''} ${reorder?.id === it.id ? 'dragging' : ''}`}
                        style={{
                          left: starts[i] * pps,
                          width: Math.max(4, it.duration * pps),
                          top,
                          height: h,
                          backgroundImage: m?.thumb && (it.type === 'video' || it.type === 'image') ? `url("${m.thumb}")` : undefined
                        }}
                        onPointerDown={(e) => (isMain ? startReorder(e, track, it) : startMove(e, it))}
                        title={label(project, it)}
                      >
                        <div className="handle left" onPointerDown={(e) => startTrim(e, track, it, 'left')} />
                        <span className="item-label">
                          {(it.type === 'video' || it.type === 'image') && it.transition.type !== 'none' && isMain && i > 0 && <b className="tr-mark">⋈ </b>}
                          {label(project, it)}
                          {it.type === 'video' && it.speed !== 1 && <b> · {it.speed}×</b>}
                          {visual && visual.anim.in.type !== 'none' && <b className="anim-mark"> ✦</b>}
                        </span>
                        {kfTimes.map((t) => (
                          <span key={t} className="kf" style={{ left: t * pps - 4 }} />
                        ))}
                        <div className="handle right" onPointerDown={(e) => startTrim(e, track, it, 'right')} />
                      </div>
                    )
                  })}
                  {track.items.length === 0 && (
                    <span className="lane-hint">
                      {track.kind === 'main'
                        ? 'Arrastra aquí videos o fotos desde «Archivos»'
                        : track.kind === 'audio'
                          ? 'Arrastra aquí una canción o un audio'
                          : 'Arrastra aquí fotos, videos o el logo; o usa «+ Texto»'}
                    </span>
                  )}
                </div>
              )
            })}

            <div className="playhead" style={{ left: time * pps }} />
          </div>
        </div>
      </div>
    </section>
  )
}
