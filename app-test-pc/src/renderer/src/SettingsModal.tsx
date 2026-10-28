import { useEffect, useState } from 'react'
import type { Settings } from '../../preload/index'
import { FONTS } from './engine/compose'
import { Icon } from './Icon'
import { useEscape } from './util'

interface Props {
  claude: { found: boolean; path: string | null; version: string | null } | null
  onRecheck: () => void
  onLogin: () => void
  onClose: () => void
}

const MODELS: [string, string][] = [
  ['opus', 'Opus (mejor calidad, recomendado)'],
  ['sonnet', 'Sonnet (más rápido)'],
  ['haiku', 'Haiku (el más rápido y económico)']
]

export function SettingsModal({ claude, onRecheck, onLogin, onClose }: Props) {
  const [s, setS] = useState<Settings | null>(null)
  const [whisper, setWhisper] = useState<Record<string, { label: string }>>({})

  useEffect(() => {
    void window.api.getSettings().then((r) => {
      setS(r.settings)
      setWhisper(r.whisperModels)
    })
  }, [])

  useEscape(onClose)
  const save = async (patch: Partial<Settings>) => setS(await window.api.setSettings(patch))

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings">
        <h2>Ajustes</h2>
        <h4>Claude Code</h4>
        <div className="group-box">
          {claude?.found ? (
            <p className="small status-line">
              <Icon name="check" size={14} className="ok" /> {claude.version}
              <span className="muted mono">{claude.path}</span>
            </p>
          ) : (
            <p className="small ai-warning">
              <Icon name="warning" size={15} /> No se encontró Claude Code. Instálalo y abre una terminal con «claude» para iniciar sesión.
            </p>
          )}
          <div className="buttons" style={{ marginTop: 0, marginBottom: 12 }}>
            <button className="small" onClick={onRecheck}>
              Volver a buscar
            </button>
            <button className="small" onClick={onLogin}>
              Abrir terminal para iniciar sesión
            </button>
          </div>
        {s && (
          <>
            <label className="field">
              <span>Ruta de Claude Code (déjalo vacío para buscarlo solo)</span>
              <input type="text" className="text mono" spellCheck={false} value={s.claudePath ?? ''} placeholder="/opt/homebrew/bin/claude" onChange={(e) => setS({ ...s, claudePath: e.target.value || null })} onBlur={() => void save({ claudePath: s.claudePath })} />
            </label>
            <label className="field">
              <span>Modelo</span>
              <select value={s.model} onChange={(e) => void save({ model: e.target.value })}>
                {MODELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        </div>
        {s && (
          <>
            <h4>Transcripción (Whisper, funciona sin internet)</h4>
            <div className="group-box">
            <label className="field">
              <span>Modelo de voz a texto (se descarga la primera vez)</span>
              <select value={s.whisperModel} onChange={(e) => void save({ whisperModel: e.target.value as Settings['whisperModel'] })}>
                {Object.entries(whisper).map(([v, m]) => (
                  <option key={v} value={v}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Idioma de la voz</span>
              <select value={s.language} onChange={(e) => void save({ language: e.target.value })}>
                <option value="spanish">Español</option>
                <option value="english">Inglés</option>
                <option value="portuguese">Portugués</option>
              </select>
            </label>
            </div>

            <h4>Marca para proyectos nuevos</h4>
            <div className="group-box">
            <div className="row">
              <label className="field">
                <span>Letra</span>
                <select value={s.brand.font} onChange={(e) => void save({ brand: { ...s.brand, font: e.target.value } })}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field color">
                <span>Principal</span>
                <input type="color" value={s.brand.primary} onChange={(e) => void save({ brand: { ...s.brand, primary: e.target.value } })} />
              </label>
              <label className="field color">
                <span>Acento</span>
                <input type="color" value={s.brand.secondary} onChange={(e) => void save({ brand: { ...s.brand, secondary: e.target.value } })} />
              </label>
            </div>
            </div>
          </>
        )}
        <div className="buttons end">
          <button className="primary" autoFocus onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
