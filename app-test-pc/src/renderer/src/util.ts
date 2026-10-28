import type { Project } from '../../shared/types'

export type Update = (fn: (p: Project) => Project, key?: string) => void

/** Qué está seleccionado: un elemento de la línea de tiempo (por id) o nada. */
export type Selection = string | null

export function formatTime(t: number): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

export const isTyping = (el: Element | null): boolean =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** Sigue el puntero desde un pointerdown; onEnd recibe si hubo arrastre real. */
export function drag(e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: (moved: boolean) => void): void {
  const x0 = e.clientX
  const y0 = e.clientY
  let moved = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0
    const dy = ev.clientY - y0
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
    if (moved) onMove(dx, dy, ev)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onEnd?.(moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
