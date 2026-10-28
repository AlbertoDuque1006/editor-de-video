import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import type { Box } from './overlays'
import type { Player } from './player'
import { clamp, formatTime, mapText, totalDuration, type Selection, type Update } from './util'

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
  const boxesRef = useRef<{ id: string; box: Box }[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
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
        boxesRef.current = player.draw(ctx, W, H)
        const s = selRef.current
        const hit = s?.kind === 'text' ? boxesRef.current.find((b) => b.id === s.id) : undefined
        if (hit) {
          ctx.strokeStyle = '#6c8cff'
          ctx.lineWidth = 3 / scale
          ctx.setLineDash([10 / scale, 6 / scale])
          ctx.strokeRect(hit.box.x, hit.box.y, hit.box.w, hit.box.h)
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

  // Arrastrar un texto sobre la vista previa lo mueve.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const toFrame = (cx: number, cy: number) => ({ x: ((cx - rect.left) / rect.width) * W, y: ((cy - rect.top) / rect.height) * H })
    const p = toFrame(e.clientX, e.clientY)
    const hit = [...boxesRef.current].reverse().find(({ box: b }) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
    if (!hit) {
      onSelect(null)
      return
    }
    onSelect({ kind: 'text', id: hit.id })
    const t0 = project.texts.find((t) => t.id === hit.id)
    if (!t0) return
    const move = (ev: PointerEvent) => {
      const q = toFrame(ev.clientX, ev.clientY)
      update(
        (pr) => mapText(pr, hit.id, (t) => ({ ...t, x: clamp(t0.x + (q.x - p.x) / W, 0, 1), y: clamp(t0.y + (q.y - p.y) / H, 0, 1) })),
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

  return (
    <section className="stage">
      <div className="stage-canvas" ref={wrapRef}>
        {project.clips.length === 0 ? (
          <div className="stage-empty">
            <p>Arrastra aquí tus videos, fotos o música</p>
            <p className="muted">o usa «Importar» en el panel de la izquierda</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={Math.round(size.w * dpr)}
            height={Math.round(size.h * dpr)}
            style={{ width: size.w, height: size.h }}
            onPointerDown={onPointerDown}
          />
        )}
      </div>
      <div className="transport">
        <button className="icon" title="Ir al inicio (Inicio)" onClick={() => onSeek(0)}>
          ⏮
        </button>
        <button className="icon play" title="Reproducir / pausar (espacio)" onClick={onTogglePlay} disabled={total === 0}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="timecode">
          {formatTime(time)} <span className="muted">/ {formatTime(total)}</span>
        </span>
      </div>
    </section>
  )
}
