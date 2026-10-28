import { useEffect, useRef, useState } from 'react'
import type { Project, VisualItem } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { clamp, findItem, mapItem, totalDuration } from '../../shared/project'
import { upsertKeyframe } from './engine/anim'
import type { Hit } from './engine/compose'
import type { Player } from './engine/player'
import { formatTime, type Selection, type Update } from './util'

interface Props {
  player: Player
  project: Project
  time: number
  playing: boolean
  sel: Selection
  onTime: (t: number) => void
  onSelect: (s: Selection) => void
  onTogglePlay: () => void
  onSeek: (t: number) => void
  update: Update
}

export function Preview({ player, project, time, playing, sel, onTime, onSelect, onTogglePlay, onSeek, update }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hitsRef = useRef<Hit[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [safe, setSafe] = useState(false)
  const { width: W, height: H } = FORMATS[project.format]

  // El lienzo ocupa el mayor tamaño posible con la proporción del formato.
  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const s = Math.min(r.width / W, r.height / H)
      setSize({ w: Math.floor(W * s), h: Math.floor(H * s) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])

  const onTimeRef = useRef(onTime)
  onTimeRef.current = onTime
  const selRef = useRef(sel)
  selRef.current = sel

  useEffect(() => {
    let raf = 0
    let last = -1
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      player.tick(now)
      const c = canvasRef.current
      const ctx = c?.getContext('2d')
      if (c && ctx && c.width > 0) {
        const scale = c.width / W
        ctx.setTransform(scale, 0, 0, scale, 0, 0)
        hitsRef.current = player.draw(ctx, W, H)
        const hit = hitsRef.current.find((h) => h.id === selRef.current)
        if (hit) {
          ctx.strokeStyle = '#7c9cff'
          ctx.lineWidth = 3 / scale
          ctx.setLineDash([10 / scale, 6 / scale])
          ctx.strokeRect(hit.x, hit.y, hit.w, hit.h)
          ctx.setLineDash([])
        }
      }
      if (player.time !== last) {
        last = player.time
        onTimeRef.current(player.time)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [player, W, H])

  // Clic: selecciona lo que esté más arriba. Arrastrar: mueve (o crea un keyframe si la posición está animada).
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const toFrame = (cx: number, cy: number) => ({ x: ((cx - rect.left) / rect.width) * W, y: ((cy - rect.top) / rect.height) * H })
    const p0 = toFrame(e.clientX, e.clientY)
    const inside = (h: Hit) => p0.x >= h.x && p0.x <= h.x + h.w && p0.y >= h.y && p0.y <= h.y + h.h
    // Si lo seleccionado está debajo del puntero, se sigue arrastrando eso (aunque haya algo encima).
    const hit = hitsRef.current.find((h) => h.id === sel && inside(h)) ?? hitsRef.current.find(inside)
    if (!hit) return onSelect(null)
    onSelect(hit.id)
    const found = findItem(project, hit.id)
    if (!found || found.item.type === 'audio') return
    const item0 = found.item as VisualItem
    const local = player.time - item0.start
    const animated = !!(item0.keyframes.x?.length || item0.keyframes.y?.length)
    const x0 = animated ? hit.x / W + hit.w / W / 2 : item0.transform.x
    const y0 = animated ? hit.y / H + hit.h / H / 2 : item0.transform.y
    const move = (ev: PointerEvent) => {
      const q = toFrame(ev.clientX, ev.clientY)
      let x = clamp(x0 + (q.x - p0.x) / W, -0.5, 1.5)
      let y = clamp(y0 + (q.y - p0.y) / H, -0.5, 1.5)
      // Imán al centro.
      if (Math.abs(x - 0.5) < 0.012) x = 0.5
      if (Math.abs(y - 0.5) < 0.012) y = 0.5
      update(
        (pr) =>
          mapItem<VisualItem>(pr, hit.id, (it) =>
            animated
              ? { ...it, keyframes: { ...it.keyframes, x: upsertKeyframe(it.keyframes.x, local, x), y: upsertKeyframe(it.keyframes.y, local, y) } }
              : { ...it, transform: { ...it.transform, x, y } }
          ),
        `mover-${hit.id}`
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const total = totalDuration(project)
  const dpr = window.devicePixelRatio || 1
  const empty = project.tracks.every((t) => t.items.length === 0)

  return (
    <section className="stage">
      <div className="stage-canvas" ref={wrapRef}>
        {empty ? (
          <div className="stage-empty">
            <p>Arrastra aquí tus videos, fotos o música</p>
            <p className="muted">o pídele a Claude que arme el video en la pestaña «IA»</p>
          </div>
        ) : (
          <div className="canvas-wrap" style={{ width: size.w, height: size.h }}>
            <canvas
              ref={canvasRef}
              width={Math.round(size.w * dpr)}
              height={Math.round(size.h * dpr)}
              style={{ width: size.w, height: size.h }}
              onPointerDown={onPointerDown}
            />
            {safe && <div className={`safe-zone f${project.format.replace(':', 'x')}`} />}
          </div>
        )}
      </div>
      <div className="transport">
        <button className="icon" title="Ir al inicio (Inicio)" onClick={() => onSeek(0)}>
          ⏮
        </button>
        <button className="icon" title="Un cuadro atrás (←)" onClick={() => onSeek(time - 1 / 30)}>
          ◀︎
        </button>
        <button className="icon play" title="Reproducir / pausar (espacio)" onClick={onTogglePlay} disabled={total === 0}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon" title="Un cuadro adelante (→)" onClick={() => onSeek(time + 1 / 30)}>
          ▶︎
        </button>
        <span className="timecode">
          {formatTime(time)} <span className="muted">/ {formatTime(total)}</span>
        </span>
        <label className="safe-toggle" title="Muestra dónde tapan los botones de Reels y TikTok">
          <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} /> Zona segura
        </label>
      </div>
    </section>
  )
}
