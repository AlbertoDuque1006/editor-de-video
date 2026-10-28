import { useState } from 'react'
import type { FormatId, MediaItem } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { formatTime } from './util'

export interface DraftRequest {
  goal: string
  format: FormatId
  seconds: number | null
  captions: boolean
  cutSilences: boolean
  logoId: string | null
  musicId: string | null
}

export interface DraftStep {
  label: string
  state: 'pending' | 'running' | 'done' | 'error'
  detail?: string
}

interface Props {
  media: MediaItem[]
  claudeReady: boolean
  steps: DraftStep[] | null
  onImport: () => void
  onCreate: (req: DraftRequest) => void
  onClose: () => void
}

const DURATIONS: [number | null, string][] = [
  [15, '15 s'],
  [30, '30 s'],
  [60, '1 min'],
  [null, 'Libre']
]

export function Wizard({ media, claudeReady, steps, onImport, onCreate, onClose }: Props) {
  const [goal, setGoal] = useState('')
  const [format, setFormat] = useState<FormatId>('9:16')
  const [seconds, setSeconds] = useState<number | null>(30)
  const [captions, setCaptions] = useState(true)
  const [cutSilences, setCutSilences] = useState(true)
  const images = media.filter((m) => m.kind === 'image')
  const audios = media.filter((m) => m.kind === 'audio')
  const [logoId, setLogoId] = useState<string | null>(null)
  const [musicId, setMusicId] = useState<string | null>(null)
  const music = musicId ?? audios[0]?.id ?? null
  const hasVoice = media.some((m) => m.kind === 'video' && m.hasAudio)
  const visual = media.filter((m) => m.kind !== 'audio')

  if (steps) {
    const failed = steps.some((s) => s.state === 'error')
    const done = steps.every((s) => s.state === 'done')
    return (
      <div className="modal-back">
        <div className="modal wizard">
          <h2>{done ? '¡Listo tu primer borrador!' : failed ? 'Algo salió mal' : 'Claude está armando tu video…'}</h2>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={s.state}>
                <span className="step-icon">{s.state === 'done' ? '✓' : s.state === 'error' ? '✕' : s.state === 'running' ? <span className="spin" /> : '·'}</span>
                <span>
                  {s.label}
                  {s.detail && <span className="muted small"> — {s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {(done || failed) && (
            <div className="buttons">
              <button className="primary" onClick={onClose}>
                {done ? 'Ver y seguir editando' : 'Cerrar'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="modal-back">
      <div className="modal wizard">
        <h2>Nuevo video con Claude</h2>
        <p className="muted">Sube tu material, cuéntale qué quieres y Claude arma el primer borrador. Después lo ajustas a mano o por chat.</p>

        <div className="wizard-section">
          <div className="bin-head">
            <h4>1. Tu material</h4>
            <button className="small" onClick={onImport}>
              Agregar archivos
            </button>
          </div>
          {media.length === 0 ? (
            <div className="drop-hint">Arrastra aquí videos, fotos, música y tu logo</div>
          ) : (
            <div className="wizard-media">
              {media.map((m) => (
                <div key={m.id} className="wm" title={m.name}>
                  <div className="thumb" style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                    {m.kind === 'audio' && <span>♪</span>}
                  </div>
                  <span className="small">{m.kind === 'image' ? 'Foto' : formatTime(m.duration)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="wizard-section">
          <h4>2. ¿Qué video quieres?</h4>
          <textarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Ej.: Reel para la barbería mostrando el corte fade de la semana. Ritmo rápido, tono juvenil, que termine invitando a reservar por WhatsApp."
          />
        </div>

        <div className="wizard-section row">
          <div className="field">
            <span>Formato</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
              {Object.entries(FORMATS).map(([id, f]) => (
                <option key={id} value={id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>Duración</span>
            <div className="segmented">
              {DURATIONS.map(([s, l]) => (
                <button key={l} className={seconds === s ? 'on' : ''} onClick={() => setSeconds(s)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="wizard-section row">
          {images.length > 0 && (
            <div className="field">
              <span>Logo</span>
              <select value={logoId ?? ''} onChange={(e) => setLogoId(e.target.value || null)}>
                <option value="">Sin logo</option>
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {audios.length > 0 && (
            <div className="field">
              <span>Música</span>
              <select value={music ?? ''} onChange={(e) => setMusicId(e.target.value || null)}>
                <option value="">Sin música</option>
                {audios.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {hasVoice && (
          <div className="checks">
            <label>
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Subtítulos automáticos
            </label>
            <label>
              <input type="checkbox" checked={cutSilences} onChange={(e) => setCutSilences(e.target.checked)} /> Quitar silencios y muletillas
            </label>
          </div>
        )}

        {!claudeReady && <p className="ai-warning small">Claude Code no está disponible en este computador. Revisa los ajustes de IA.</p>}

        <div className="buttons end">
          <button onClick={onClose}>Empezar en blanco</button>
          <button
            className="primary"
            disabled={!claudeReady || visual.length === 0}
            onClick={() => onCreate({ goal, format, seconds, captions: hasVoice && captions, cutSilences: hasVoice && cutSilences, logoId, musicId: music })}
          >
            ✨ Crear con Claude
          </button>
        </div>
      </div>
    </div>
  )
}
