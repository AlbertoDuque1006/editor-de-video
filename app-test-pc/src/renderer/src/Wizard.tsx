import { useState } from 'react'
import type { FormatId, MediaItem } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { Icon } from './Icon'
import { formatTime, MOD, useEscape } from './util'

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
  const running = !!steps && steps.some((s) => s.state === 'running')
  useEscape(running ? null : onClose)

  if (steps) {
    const failed = steps.some((s) => s.state === 'error')
    const done = steps.every((s) => s.state === 'done')
    return (
      <div className="modal-back">
        <div className="modal wizard">
          <h2>{done ? 'Tu primer borrador está listo' : failed ? 'Algo salió mal' : 'Claude está armando tu video…'}</h2>
          <p className="lead">{done ? `Revísalo y ajústalo a mano o por chat. Con ${MOD}Z deshaces cualquier cambio.` : failed ? 'Puedes cerrar y seguir a mano, o intentarlo de nuevo.' : 'Puede tomar uno o dos minutos. No cierres la app.'}</p>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={s.state}>
                <span className="step-icon">
                  {s.state === 'done' ? <Icon name="check" size={15} /> : s.state === 'error' ? <Icon name="close" size={14} /> : s.state === 'running' ? <span className="spin" /> : <Icon name="diamond" size={6} />}
                </span>
                <span>
                  {s.label}
                  {s.detail && <span className="muted small"> — {s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {(done || failed) && (
            <div className="buttons end">
              <button className="primary" autoFocus onClick={onClose}>
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
        <p className="lead">Sube tu material, cuéntale qué quieres y Claude arma el primer borrador. Después lo ajustas a mano o por chat.</p>

        <div className="wizard-section">
          <div className="bin-head">
            <h4>1. Tu material</h4>
            <button className="small" onClick={onImport}>
              <Icon name="plus" size={12} /> Agregar archivos
            </button>
          </div>
          {media.length === 0 ? (
            <div className="drop-hint">
              <Icon name="import" size={26} />
              Arrastra aquí videos, fotos, música y tu logo
            </div>
          ) : (
            <div className="wizard-media">
              {media.map((m) => (
                <div key={m.id} className="wm" title={m.name}>
                  <div className={`mc-thumb ${m.kind}`} style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                    {m.kind === 'audio' && <Icon name="music" size={18} />}
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

        {!claudeReady && (
          <p className="ai-warning small">
            <Icon name="warning" size={15} /> Claude Code no está disponible en este computador. Revísalo en Ajustes.
          </p>
        )}

        <div className="buttons end">
          <button onClick={onClose}>Empezar en blanco</button>
          <button
            className="primary"
            disabled={!claudeReady || visual.length === 0}
            onClick={() => onCreate({ goal, format, seconds, captions: hasVoice && captions, cutSilences: hasVoice && cutSilences, logoId, musicId: music })}
          >
            <Icon name="sparkles" size={14} /> Crear con Claude
          </button>
        </div>
      </div>
    </div>
  )
}
