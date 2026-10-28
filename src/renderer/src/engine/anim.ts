import type { AnimProp, Easing, Keyframe, VisualItem } from '../../../shared/types'
import { clamp } from '../../../shared/project'

export const EASINGS: Record<Easing, (x: number) => number> = {
  linear: (x) => x,
  'ease-in': (x) => x * x * x,
  'ease-out': (x) => 1 - (1 - x) ** 3,
  'ease-in-out': (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  'back-out': (x) => {
    const c = 1.70158
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
  },
  bounce: (x) => {
    const n = 7.5625
    const d = 2.75
    if (x < 1 / d) return n * x * x
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375
    return n * (x -= 2.625 / d) * x + 0.984375
  }
}

/** Valor de una propiedad animada en el segundo local t (antes del primero / después del último se queda quieto). */
export function interpolate(kfs: Keyframe[], t: number): number {
  if (t <= kfs[0].t) return kfs[0].v
  const last = kfs[kfs.length - 1]
  if (t >= last.t) return last.v
  const i = kfs.findIndex((k) => k.t > t)
  const a = kfs[i - 1]
  const b = kfs[i]
  const x = (t - a.t) / (b.t - a.t || 1)
  return a.v + (b.v - a.v) * EASINGS[b.ease](x)
}

export interface Evaluated {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  /** Fracción del alto del cuadro. */
  blur: number
  /** Para textos: qué parte se ve (máquina de escribir / palabra por palabra). */
  reveal: number
  revealMode: 'none' | 'chars' | 'words'
}

const PROPS: AnimProp[] = ['x', 'y', 'scale', 'rotation', 'opacity']

/** Aplica transform base, keyframes, movimiento continuo y animaciones de entrada/salida en el segundo local. */
export function evaluate(item: VisualItem, local: number): Evaluated {
  const e: Evaluated = { ...item.transform, blur: 0, reveal: 1, revealMode: 'none' }
  for (const p of PROPS) {
    const kfs = item.keyframes[p]
    if (kfs?.length) e[p] = interpolate(kfs, local)
  }

  const d = item.duration
  const p = d > 0 ? clamp(local / d, 0, 1) : 0
  switch (item.anim.loop) {
    case 'ken-burns-in':
      e.scale *= 1 + 0.15 * p
      break
    case 'ken-burns-out':
      e.scale *= 1.15 - 0.15 * p
      break
    case 'pan-left':
      e.scale *= 1.12
      e.x += 0.05 - 0.1 * p
      break
    case 'pan-right':
      e.scale *= 1.12
      e.x += -0.05 + 0.1 * p
      break
    case 'pulse':
      e.scale *= 1 + 0.05 * Math.sin((2 * Math.PI * local) / 1.2)
      break
    case 'float':
      e.y += 0.012 * Math.sin((2 * Math.PI * local) / 2.5)
      break
    case 'shake':
      e.x += 0.006 * Math.sin(local * 47)
      e.y += 0.006 * Math.sin(local * 61)
      e.rotation += 0.8 * Math.sin(local * 37)
      break
  }

  // Si entrada + salida no caben en la duración, se reparten.
  let din = item.anim.in.type === 'none' ? 0 : item.anim.in.duration
  let dout = item.anim.out.type === 'none' ? 0 : item.anim.out.duration
  if (din + dout > d && din + dout > 0) {
    const k = d / (din + dout)
    din *= k
    dout *= k
  }

  if (din > 0 && local < din) {
    const raw = clamp(local / din, 0, 1)
    applyMotion(e, item.anim.in.type, EASINGS['ease-out'](raw), raw, 'in')
  }
  if (dout > 0 && local > d - dout) {
    const raw = clamp((d - local) / dout, 0, 1)
    applyMotion(e, item.anim.out.type, EASINGS['ease-out'](raw), raw, 'out')
  }
  return e
}

/** q va de 0 (fuera de escena) a 1 (en su sitio). */
function applyMotion(e: Evaluated, type: string, q: number, raw: number, dir: 'in' | 'out'): void {
  const away = 1 - q
  const sign = dir === 'in' ? 1 : -1
  switch (type) {
    case 'fade':
      e.opacity *= q
      break
    case 'slide-up':
      e.y += sign * away * 0.15
      e.opacity *= q
      break
    case 'slide-down':
      e.y -= sign * away * 0.15
      e.opacity *= q
      break
    case 'slide-left':
      e.x += sign * away * 0.3
      e.opacity *= q
      break
    case 'slide-right':
      e.x -= sign * away * 0.3
      e.opacity *= q
      break
    case 'zoom-in':
      e.scale *= 0.5 + 0.5 * q
      e.opacity *= q
      break
    case 'zoom-out':
      e.scale *= 1.5 - 0.5 * q
      e.opacity *= q
      break
    case 'pop':
      e.scale *= Math.max(0, EASINGS['back-out'](raw))
      break
    case 'spin':
      e.rotation -= sign * away * 180
      e.scale *= q
      break
    case 'blur':
      e.blur += away * 0.03
      e.opacity *= q
      break
    case 'typewriter':
      e.reveal = raw
      e.revealMode = 'chars'
      break
    case 'words':
      e.reveal = raw
      e.revealMode = 'words'
      break
  }
}

/** Valor de una propiedad en el segundo local, sin las animaciones automáticas (para editar keyframes). */
export function baseValue(item: VisualItem, prop: AnimProp, local: number): number {
  const kfs = item.keyframes[prop]
  return kfs?.length ? interpolate(kfs, local) : item.transform[prop]
}

/** Crea o actualiza el keyframe de prop en el segundo local (a menos de medio cuadro se considera el mismo). */
export function upsertKeyframe(kfs: Keyframe[] | undefined, t: number, v: number, ease: Easing = 'ease-in-out'): Keyframe[] {
  const list = [...(kfs ?? [])]
  const i = list.findIndex((k) => Math.abs(k.t - t) < 1 / 60)
  if (i >= 0) list[i] = { ...list[i], v }
  else list.push({ t, v, ease })
  return list.sort((a, b) => a.t - b.t)
}
