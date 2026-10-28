import type { MediaItem, Project } from '../../shared/types'
import { formatTime } from './util'

export interface MediaStatus {
  /** Preparando la copia para editar (0 a 1). */
  proxy?: number
  /** Transcribiendo. */
  transcribing?: boolean
}

interface Props {
  project: Project
  status: Record<string, MediaStatus>
  onImport: () => void
  onAddClip: (m: MediaItem) => void
  onSetMusic: (m: MediaItem) => void
  onSetLogo: (m: MediaItem) => void
  onTranscribe: (m: MediaItem) => void
  onRemove: (m: MediaItem) => void
}

const KIND_LABEL = { video: 'Video', image: 'Foto', audio: 'Audio' }

export function MediaBin({ project, status, onImport, onAddClip, onSetMusic, onSetLogo, onTranscribe, onRemove }: Props) {
  const uses = (id: string) => project.tracks.reduce((n, t) => n + t.items.filter((i) => 'mediaId' in i && i.mediaId === id).length, 0)
  return (
    <div className="bin">
      <div className="bin-head">
        <h3>Archivos</h3>
        <button className="primary small" onClick={onImport}>
          Importar
        </button>
      </div>
      {project.media.length === 0 && <p className="muted small bin-empty">Importa o arrastra a la ventana tus videos, fotos, canciones y el logo.</p>}
      <ul className="media-list">
        {project.media.map((m) => {
          const n = uses(m.id)
          const st = status[m.id] ?? {}
          const transcript = project.transcripts.find((t) => t.mediaId === m.id)
          return (
            <li
              key={m.id}
              className="media"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-media-id', m.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => (m.kind === 'audio' ? onSetMusic(m) : onAddClip(m))}
            >
              <div className="thumb" style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                {m.kind === 'audio' && <span>♪</span>}
                {st.proxy !== undefined && <div className="thumb-progress" style={{ width: `${st.proxy * 100}%` }} />}
              </div>
              <div className="media-info">
                <span className="media-name" title={m.path}>
                  {m.name}
                </span>
                <span className="muted small">
                  {KIND_LABEL[m.kind]}
                  {m.kind !== 'image' && ` · ${formatTime(m.duration)}`}
                  {n > 0 && ` · en uso ×${n}`}
                  {st.proxy !== undefined && ' · preparando…'}
                  {st.transcribing && ' · transcribiendo…'}
                  {transcript && !st.transcribing && ' · 🗣 transcrito'}
                </span>
                <span className="media-actions">
                  {m.kind !== 'audio' && (
                    <button className="small" onClick={() => onAddClip(m)} title="Agregar al final del video principal">
                      + Agregar
                    </button>
                  )}
                  {m.kind === 'image' && (
                    <button className={`small ${project.brand.logoMediaId === m.id ? 'on' : ''}`} onClick={() => onSetLogo(m)} title="Usar como logo en una esquina">
                      Logo
                    </button>
                  )}
                  {m.hasAudio && (
                    <button className="small" onClick={() => onSetMusic(m)} title="Usar como música de fondo">
                      Música
                    </button>
                  )}
                  {m.hasAudio && !transcript && !st.transcribing && (
                    <button className="small" onClick={() => onTranscribe(m)} title="Pasar la voz a texto (para subtítulos y para que Claude entienda el video)">
                      Transcribir
                    </button>
                  )}
                </span>
              </div>
              <button className="remove" title={n ? 'Quitar del proyecto (también de la línea de tiempo)' : 'Quitar del proyecto'} onClick={() => onRemove(m)}>
                ×
              </button>
            </li>
          )
        })}
      </ul>
      {project.media.length > 0 && <p className="muted small bin-tip">Arrastra un archivo a una pista, o haz doble clic para agregarlo al final.</p>}
    </div>
  )
}
