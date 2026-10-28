import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { MOD } from './util'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error' | 'info'
  text: string
  /** Cambios aplicados con este mensaje. */
  changes?: number
  warnings?: string[]
}

export interface ClaudeState {
  checked: boolean
  found: boolean
  version: string | null
}

interface Props {
  messages: ChatMessage[]
  busy: boolean
  status: string
  claude: ClaudeState
  hasMedia: boolean
  onSend: (text: string) => void
  onCancel: () => void
  onQuick: (action: QuickAction) => void
  onLogin: () => void
  onRecheck: () => void
  onNewChat: () => void
}

export type QuickAction = 'captions' | 'silences' | 'highlights' | 'copy' | 'cleanup' | 'rhythm'

const QUICK: { id: QuickAction; icon: IconName; label: string; hint: string; local?: boolean }[] = [
  { id: 'captions', icon: 'captions', label: 'Subtítulos automáticos', hint: 'Transcribe la voz y pone subtítulos palabra por palabra', local: true },
  { id: 'silences', icon: 'scissors', label: 'Quitar silencios y muletillas', hint: 'Corta pausas largas, "eh", "mmm"…', local: true },
  { id: 'cleanup', icon: 'broom', label: 'Quitar repeticiones y errores', hint: 'Claude lee la transcripción y quita frases repetidas o equivocadas' },
  { id: 'highlights', icon: 'target', label: 'Reel con los mejores momentos', hint: 'Claude mira el material y arma un video corto' },
  { id: 'rhythm', icon: 'bolt', label: 'Darle ritmo y animaciones', hint: 'Gancho, textos animados, transiciones y movimiento' },
  { id: 'copy', icon: 'pencil', label: 'Título, descripción y hashtags', hint: 'Textos para publicar' }
]

const EXAMPLES = [
  'Pon un título grande al inicio que diga "Corte de la semana" con animación de rebote',
  'Haz que la foto del final se acerque lentamente y termine con un fundido a negro',
  'Acelera las partes donde no se habla al doble',
  'Usa colores más cálidos en todo el video'
]

export function AiPanel(props: Props) {
  const { messages, busy, status, claude } = props
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!messages.length && !busy) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy])

  const send = () => {
    const t = text.trim()
    if (!t || busy) return
    props.onSend(t)
    setText('')
  }

  const offline = claude.checked && !claude.found

  return (
    <div className="ai">
      <div className="panel-head">
        <h3>Asistente IA</h3>
        <button className="plain icon" onClick={props.onNewChat} disabled={busy || messages.length === 0} title="Conversación nueva (Claude olvida lo hablado)" aria-label="Conversación nueva">
          <Icon name="compose" size={15} />
        </button>
      </div>

      {offline && (
        <div className="ai-warning">
          <Icon name="warning" size={16} />
          <div>
          <b>No encontré Claude Code en este computador.</b>
          <p className="small">
            Instálalo desde <span className="mono">code.claude.com</span>, abre una terminal, escribe <span className="mono">claude</span> e inicia sesión. Luego vuelve aquí.
          </p>
          <div className="buttons">
            <button onClick={props.onLogin}>Abrir terminal</button>
            <button onClick={props.onRecheck}>Volver a buscar</button>
          </div>
          </div>
        </div>
      )}

      <div className="quick">
        {QUICK.map((q) => (
          <button key={q.id} disabled={busy || !props.hasMedia || (!q.local && offline)} title={q.hint} onClick={() => props.onQuick(q.id)}>
            <Icon name={q.icon} size={16} />
            {q.label}
          </button>
        ))}
      </div>

      <div className="chat" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="muted small">Pídele cambios a Claude con tus palabras. Por ejemplo:</p>
            {EXAMPLES.map((e) => (
              <button key={e} className="example" onClick={() => setText(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <p>{m.text}</p>
            {m.changes !== undefined && m.changes > 0 && <span className="msg-meta">{m.changes} cambio(s) aplicados · puedes deshacer con {MOD}Z</span>}
            {m.warnings?.length ? (
              <details className="msg-meta">
                <summary>{m.warnings.length} cambio(s) no se pudieron aplicar</summary>
                <ul>
                  {m.warnings.map((w, j) => (
                    <li key={j}>{w}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
        {busy && (
          <div className="msg assistant working">
            <span className="dots" /> {status || 'Trabajando…'}
            <button className="small" onClick={props.onCancel} title="Detener a Claude">
              <Icon name="stop" size={11} /> Detener
            </button>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          rows={3}
          value={text}
          aria-label="Mensaje para Claude"
          placeholder={offline ? 'Claude Code no está disponible' : 'Pídele un cambio a Claude…'}
          disabled={offline}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="primary" disabled={busy || !text.trim() || offline} onClick={send} title="Enviar (Intro)" aria-label="Enviar">
          <Icon name="send" size={15} />
        </button>
      </div>
      {claude.version && <p className="tiny" title="Usa la sesión de Claude Code de este computador">
          {claude.version} · ⇧Intro: salto de línea
        </p>}
    </div>
  )
}
