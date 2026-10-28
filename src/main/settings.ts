import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Brand } from '../shared/types'
import { defaultBrand } from '../shared/project'
import { dataDir } from './env'

export interface Settings {
  /** Ruta de Claude Code si no se encuentra sola. */
  claudePath: string | null
  /** Modelo que usa Claude Code: opus, sonnet, haiku o un id completo. */
  model: string
  whisperModel: 'base' | 'small' | 'turbo'
  language: string
  /** Marca que se aplica a los proyectos nuevos. */
  brand: Brand
}

const DEFAULTS: Settings = { claudePath: null, model: 'opus', whisperModel: 'small', language: 'spanish', brand: defaultBrand() }

const file = () => join(dataDir(), 'ajustes.json')

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8'))
    return { ...DEFAULTS, ...saved, brand: { ...DEFAULTS.brand, ...saved.brand } }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  if (!['base', 'small', 'turbo'].includes(next.whisperModel)) next.whisperModel = 'small'
  if (typeof next.model !== 'string' || !/^[\w.-]{1,60}$/.test(next.model)) next.model = 'opus'
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
