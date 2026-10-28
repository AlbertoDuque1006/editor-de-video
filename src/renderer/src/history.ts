import { useCallback, useReducer, useRef } from 'react'
import type { Project } from '../../shared/types'
import { normalizeProject } from '../../shared/project'

interface History {
  past: Project[]
  present: Project
  future: Project[]
  lastKey?: string
  lastAt: number
}

const LIMIT = 150
// Cambios seguidos con la misma clave (arrastrar un deslizador) cuentan como un solo paso de "deshacer".
// Todo cambio pasa por normalizeProject, así la pista principal siempre queda en fila.
const COALESCE_MS = 800

/**
 * El historial vive en una ref y se actualiza en el acto: así varias órdenes seguidas (por ejemplo, cortar silencios
 * y luego rehacer los subtítulos) parten siempre del proyecto más reciente, aunque React aún no haya vuelto a pintar.
 */
export function useHistory(initial: () => Project) {
  const hRef = useRef<History | null>(null)
  hRef.current ??= { past: [], present: initial(), future: [], lastAt: 0 }
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const projectRef = useRef<Project>(hRef.current.present)

  const set = useCallback((h: History) => {
    if (h === hRef.current) return
    hRef.current = h
    projectRef.current = h.present
    rerender()
  }, [])

  const update = useCallback(
    (fn: (p: Project) => Project, key?: string) => {
      const h = hRef.current!
      const next = normalizeProject(fn(h.present))
      if (next === h.present) return
      const now = Date.now()
      const coalesce = key !== undefined && key === h.lastKey && now - h.lastAt < COALESCE_MS
      set({ past: coalesce ? h.past : [...h.past, h.present].slice(-LIMIT), present: next, future: [], lastKey: key, lastAt: now })
    },
    [set]
  )

  const undo = useCallback(() => {
    const h = hRef.current!
    if (h.past.length) set({ past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastAt: 0 })
  }, [set])

  const redo = useCallback(() => {
    const h = hRef.current!
    if (h.future.length) set({ past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastAt: 0 })
  }, [set])

  const reset = useCallback((p: Project) => set({ past: [], present: p, future: [], lastAt: 0 }), [set])

  const h = hRef.current
  return {
    project: h.present,
    /** Siempre el proyecto más reciente (para leer después de una orden sin esperar a que React pinte). */
    projectRef,
    update,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0
  }
}
