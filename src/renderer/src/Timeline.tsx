import { useEffect, useRef, useState } from 'react'
import type { Clip, Project, TextItem } from '../../shared/types'
import {
  clamp,
  clipDur,
  clipStarts,
  findMedia,
  formatTime,
  mapClip,
  mapText,
  maxOut,
  MIN_CLIP,
  moveTo,
  totalDuration,
  type Selection,
  type Update
} from './util'

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
  onAddText: () => void
  onSplit: () => void
  onDelete: () => void
}

const ROW_H = 26

/** Sigue el puntero desde un pointerdown; onEnd recibe si hubo arrastre real. */
function drag(e: React.PointerEvent, onMove: (dx: number, ev: PointerEvent) => void, onEnd?: (moved: boolean) => void) {
  const x0 = e.clientX
  let moved = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0
    if (Math.abs(dx) > 3) moved = true
    if (moved) onMove(dx, ev)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onEnd?.(moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** Reparte los textos en filas para que no se tapen entre sí. */
function textRows(texts: TextItem[]): Map<string, number> {
  const rows: number[] = []
  const out = new Map<string, number>()
  for (const t of [...texts].sort((a, b) => a.start - b.start)) {
    let r = rows.findIndex((end) => end <= t.start + 1e-6)
    if (r < 0) r = rows.push(0) - 1
    rows[r] = t.end
    out.set(t.id, r)
  }
  return out
}

function tickStep(pps: number): number {
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) ?? 300
}

export function Timeline(props: Props) {
  const { project, time, playing, sel, pps, onZoom, onSelect, onSeek, update } = props
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [reorder, setReorder] = useState<{ id: string; index: number } | null>(null)

  const total = totalDuration(project)
  const width = Math.max(total + 5, 20) * pps
  const xToTime = (clientX: number) => (clientX - contentRef.current!.getBoundingClientRect().left) / pps

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
    drag(e, (_dx, ev) => onSeek(xToTime(ev.clientX)))
  }

  // --- Clips ---
  const clips = project.clips
  const shown = reorder ? moveTo(clips, reorder.id, reorder.index) : clips
  const starts = clipStarts(shown)

  const startClipDrag = (e: React.PointerEvent, c: Clip, start: number) => {
    onSelect({ kind: 'clip', id: c.id })
    const others = clips.filter((o) => o.id !== c.id)
    let drop: number | null = null
    drag(
      e,
      (_dx, ev) => {
        const t = xToTime(ev.clientX)
        let acc = 0
        let index = 0
        for (; index < others.length; index++) {
          const d = clipDur(others[index])
          if (t < acc + d / 2) break
          acc += d
        }
        drop = index
        setReorder({ id: c.id, index })
      },
      (moved) => {
        setReorder(null)
        if (moved && drop !== null) {
          const index = drop
          update((p) => ({ ...p, clips: moveTo(p.clips, c.id, index) }))
        }
        if (!moved && (time < start || time >= start + clipDur(c))) onSeek(start)
      }
    )
  }

  const startTrim = (e: React.PointerEvent, c0: Clip, side: 'left' | 'right') => {
    e.stopPropagation()
    onSelect({ kind: 'clip', id: c0.id })
    const m = findMedia(project, c0.mediaId)
    const image = m?.kind === 'image'
    drag(e, (dx) => {
      const d = dx / pps
      update(
        (p) =>
          mapClip(p, c0.id, (c) => {
            if (side === 'right') return { ...c, out: clamp(c0.out + d, c0.in + MIN_CLIP, maxOut(m)) }
            if (image) return { ...c, out: Math.max(MIN_CLIP, c0.out - d) }
            return { ...c, in: clamp(c0.in + d, 0, c0.out - MIN_CLIP) }
          }),
        `recorte-${c0.id}`
      )
    })
  }

  // --- Textos ---
  const rows = textRows(project.texts)
  const nRows = Math.max(1, ...[...rows.values()].map((r) => r + 1))

  const startTextDrag = (e: React.PointerEvent, t0: TextItem, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation()
    onSelect({ kind: 'text', id: t0.id })
    drag(
      e,
      (dx) => {
        const d = dx / pps
        update(
          (p) =>
            mapText(p, t0.id, (t) => {
              if (mode === 'left') return { ...t, start: clamp(t0.start + d, 0, t0.end - MIN_CLIP) }
              if (mode === 'right') return { ...t, end: Math.max(t0.start + MIN_CLIP, t0.end + d) }
              const start = Math.max(0, t0.start + d)
              return { ...t, start, end: start + (t0.end - t0.start) }
            }),
          `texto-${mode}-${t0.id}`
        )
      },
      (moved) => {
        if (!moved && (time < t0.start || time >= t0.end)) onSeek(t0.start)
      }
    )
  }

  const step = tickStep(pps)
  const ticks: number[] = []
  for (let t = 0; t * pps <= width; t += step) ticks.push(t)

  const musicMedia = project.music ? findMedia(project, project.music.mediaId) : undefined
  const selected = sel && 'id' in sel ? sel.id : sel?.kind

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <button onClick={props.onAddText}>+ Texto</button>
        <button onClick={props.onSplit} disabled={clips.length === 0} title="Dividir el clip en el cursor (S)">
          ✂ Dividir
        </button>
        <button onClick={props.onDelete} disabled={!sel} title="Eliminar lo seleccionado (Supr)">
          Eliminar
        </button>
        <span className="spacer" />
        <span className="muted">Duración {formatTime(total)}</span>
        <label className="zoom">
          <span className="muted">Zoom</span>
          <input type="range" min={8} max={240} value={pps} onChange={(e) => onZoom(Number(e.target.value))} />
        </label>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <div className="ruler" />
          <div className="lane-label" style={{ height: 64 }}>
            Video
          </div>
          <div className="lane-label" style={{ height: nRows * ROW_H + 8 }}>
            Textos
          </div>
          <div className="lane-label" style={{ height: 34 }}>
            Música
          </div>
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

            <div className="lane" style={{ height: 64 }} onPointerDown={scrub}>
              {shown.map((c, i) => {
                const m = findMedia(project, c.mediaId)
                const d = clipDur(c)
                return (
                  <div
                    key={c.id}
                    className={`clip ${m?.kind ?? ''} ${selected === c.id ? 'selected' : ''} ${reorder?.id === c.id ? 'dragging' : ''}`}
                    style={{
                      left: starts[i] * pps,
                      width: Math.max(4, d * pps),
                      backgroundImage: m?.thumb ? `url("${m.thumb}")` : undefined
                    }}
                    onPointerDown={(e) => startClipDrag(e, c, starts[i])}
                    title={m?.name}
                  >
                    <div className="handle left" onPointerDown={(e) => startTrim(e, c, 'left')} />
                    <span className="clip-label">
                      {m?.name ?? 'Archivo no encontrado'} · {d.toFixed(1)} s
                    </span>
                    <div className="handle right" onPointerDown={(e) => startTrim(e, c, 'right')} />
                  </div>
                )
              })}
              {clips.length === 0 && <span className="lane-hint">Agrega videos o fotos desde «Archivos»</span>}
            </div>

            <div className="lane" style={{ height: nRows * ROW_H + 8 }} onPointerDown={scrub}>
              {project.texts.map((t) => (
                <div
                  key={t.id}
                  className={`text-block ${selected === t.id ? 'selected' : ''}`}
                  style={{ left: t.start * pps, width: Math.max(6, (t.end - t.start) * pps), top: 4 + (rows.get(t.id) ?? 0) * ROW_H }}
                  onPointerDown={(e) => startTextDrag(e, t, 'move')}
                  title={t.text}
                >
                  <div className="handle left" onPointerDown={(e) => startTextDrag(e, t, 'left')} />
                  <span className="clip-label">{t.text.split('\n')[0] || '(vacío)'}</span>
                  <div className="handle right" onPointerDown={(e) => startTextDrag(e, t, 'right')} />
                </div>
              ))}
            </div>

            <div className="lane" style={{ height: 34 }} onPointerDown={scrub}>
              {project.music && musicMedia ? (
                <div
                  className={`music-block ${selected === 'music' ? 'selected' : ''}`}
                  style={{ width: Math.max(6, Math.min(total, musicMedia.duration || total) * pps) }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onSelect({ kind: 'music' })
                  }}
                >
                  <span className="clip-label">♪ {musicMedia.name}</span>
                </div>
              ) : (
                <span className="lane-hint">Sin música. En «Archivos», elige una canción y pulsa «Música».</span>
              )}
            </div>

            <div className="playhead" style={{ left: time * pps }} />
          </div>
        </div>
      </div>
    </section>
  )
}
