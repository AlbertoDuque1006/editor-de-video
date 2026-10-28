import { useCallback, useState } from 'react'
import type { Project } from '../../shared/types'

interface History {
  past: Project[]
  present: Project
  future: Project[]
  lastKey?: string
  lastAt: number
}

const LIMIT = 150
// Cambios seguidos con la misma clave (arrastrar un deslizador) cuentan como un solo paso de "deshacer".
const COALESCE_MS = 800

export function useHistory(initial: () => Project) {
  const [h, setH] = useState<History>(() => ({ past: [], present: initial(), future: [], lastAt: 0 }))

  const update = useCallback((fn: (p: Project) => Project, key?: string) => {
    setH((h) => {
      const next = fn(h.present)
      if (next === h.present) return h
      const now = Date.now()
      const coalesce = key !== undefined && key === h.lastKey && now - h.lastAt < COALESCE_MS
      return {
        past: coalesce ? h.past : [...h.past, h.present].slice(-LIMIT),
        present: next,
        future: [],
        lastKey: key,
        lastAt: now
      }
    })
  }, [])

  const undo = useCallback(() => {
    setH((h) =>
      h.past.length
        ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastAt: 0 }
        : h
    )
  }, [])

  const redo = useCallback(() => {
    setH((h) =>
      h.future.length
        ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastAt: 0 }
        : h
    )
  }, [])

  const reset = useCallback((p: Project) => setH({ past: [], present: p, future: [], lastAt: 0 }), [])

  return {
    project: h.present,
    update,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0
  }
}
