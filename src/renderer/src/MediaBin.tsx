import type { MediaItem, Project } from '../../shared/types'
import { formatTime, type Selection } from './util'

interface Props {
  project: Project
  sel: Selection
  onImport: () => void
  onAddClip: (m: MediaItem) => void
  onSetMusic: (m: MediaItem) => void
  onSetLogo: (m: MediaItem) => void
  onRemove: (m: MediaItem) => void
  onSelect: (s: Selection) => void
}

const KIND_LABEL = { video: 'Video', image: 'Foto', audio: 'Audio' }

export function MediaBin({ project, sel, onImport, onAddClip, onSetMusic, onSetLogo, onRemove, onSelect }: Props) {
  return (
    <aside className="bin">
      <div className="bin-head">
        <h3>Archivos</h3>
        <button className="primary small" onClick={onImport}>
          Importar
        </button>
      </div>
      {project.media.length === 0 && <p className="muted small bin-empty">Importa o arrastra a la ventana tus videos, fotos, canciones y el logo.</p>}
      <ul className="media-list">
        {project.media.map((m) => {
          const inUse = project.clips.filter((c) => c.mediaId === m.id).length
          const isMusic = project.music?.mediaId === m.id
          const isLogo = project.logo?.mediaId === m.id
          return (
            <li key={m.id} className="media" onDoubleClick={() => m.kind !== 'audio' && onAddClip(m)}>
              <div className="thumb" style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                {m.kind === 'audio' && <span>♪</span>}
              </div>
              <div className="media-info">
                <span className="media-name" title={m.path}>
                  {m.name}
                </span>
                <span className="muted small">
                  {KIND_LABEL[m.kind]}
                  {m.kind !== 'image' && ` · ${formatTime(m.duration)}`}
                  {inUse > 0 && ` · en uso ×${inUse}`}
                  {isMusic && ' · música'}
                  {isLogo && ' · logo'}
                </span>
                <span className="media-actions">
                  {m.kind !== 'audio' && (
                    <button className="small" onClick={() => onAddClip(m)} title="Agregar al final de la línea de tiempo">
                      + Agregar
                    </button>
                  )}
                  {m.kind === 'image' && (
                    <button
                      className={`small ${isLogo ? 'on' : ''}`}
                      onClick={() => (isLogo ? onSelect({ kind: 'logo' }) : onSetLogo(m))}
                      title="Usar como logo en una esquina"
                    >
                      Logo
                    </button>
                  )}
                  {(m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)) && (
                    <button
                      className={`small ${isMusic ? 'on' : ''}`}
                      onClick={() => (isMusic ? onSelect({ kind: 'music' }) : onSetMusic(m))}
                      title="Usar como música de fondo"
                    >
                      Música
                    </button>
                  )}
                </span>
              </div>
              <button
                className="remove"
                title={inUse || isMusic || isLogo ? 'Quitar del proyecto (también de la línea de tiempo)' : 'Quitar del proyecto'}
                onClick={() => onRemove(m)}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      {sel === null && project.media.length > 0 && <p className="muted small bin-tip">Doble clic en un archivo para agregarlo al final.</p>}
    </aside>
  )
}
