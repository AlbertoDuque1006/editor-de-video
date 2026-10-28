import type { CtxItem } from '../../preload/index'
import type { MediaItem, Project } from '../../shared/types'
import { Icon } from './Icon'
import { formatTime, MOD } from './util'

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

const KIND_ICON = { video: 'film', image: 'photo', audio: 'music' } as const
const KIND_LABEL = { video: 'Video', image: 'Foto', audio: 'Audio' }

export function MediaBin({ project, status, onImport, onAddClip, onSetMusic, onSetLogo, onTranscribe, onRemove }: Props) {
  const uses = (id: string) => project.tracks.reduce((n, t) => n + t.items.filter((i) => 'mediaId' in i && i.mediaId === id).length, 0)

  const menu = async (m: MediaItem) => {
    const transcript = project.transcripts.some((t) => t.mediaId === m.id)
    const st = status[m.id] ?? {}
    const items: CtxItem[] = []
    if (m.kind !== 'audio') items.push({ id: 'add', label: 'Agregar al final del video' })
    if (m.hasAudio) items.push({ id: 'music', label: 'Usar como música de fondo' })
    if (m.kind === 'image') items.push({ id: 'logo', label: 'Usar como logo', checked: project.brand.logoMediaId === m.id })
    if (m.hasAudio) items.push({ id: 'transcribe', label: transcript ? 'Ya está transcrito' : 'Transcribir la voz', enabled: !transcript && !st.transcribing })
    items.push({ type: 'separator' }, { id: 'show', label: window.api.platform === 'darwin' ? 'Mostrar en Finder' : 'Mostrar en la carpeta' }, { type: 'separator' })
    items.push({ id: 'remove', label: uses(m.id) ? 'Quitar del proyecto y de la línea de tiempo' : 'Quitar del proyecto' })
    const pick = await window.api.contextMenu(items)
    if (pick === 'add') onAddClip(m)
    else if (pick === 'music') onSetMusic(m)
    else if (pick === 'logo') onSetLogo(m)
    else if (pick === 'transcribe') onTranscribe(m)
    else if (pick === 'show') window.api.showInFolder(m.path)
    else if (pick === 'remove') onRemove(m)
  }

  return (
    <div className="bin">
      <div className="panel-head">
        <h3>
          Archivos{project.media.length > 0 && <span className="count">{project.media.length}</span>}
        </h3>
        <button className="small" onClick={onImport} title={`Importar archivos (${MOD}I)`}>
          <Icon name="plus" size={13} /> Importar
        </button>
      </div>
      {project.media.length === 0 ? (
        <div className="empty-drop" onClick={onImport}>
          <Icon name="import" size={30} />
          <b>Importa tu material</b>
          <span className="small">Arrastra a la ventana tus videos, fotos, canciones y el logo, o haz clic aquí.</span>
        </div>
      ) : (
        <ul className="media-grid">
          {project.media.map((m) => {
            const n = uses(m.id)
            const st = status[m.id] ?? {}
            const transcript = project.transcripts.some((t) => t.mediaId === m.id)
            const isLogo = project.brand.logoMediaId === m.id
            return (
              <li
                key={m.id}
                className="media-card"
                draggable
                title={m.path}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-media-id', m.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDoubleClick={() => (m.kind === 'audio' ? onSetMusic(m) : onAddClip(m))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void menu(m)
                }}
              >
                <div className={`mc-thumb ${m.kind}`} style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                  {m.kind === 'audio' && <Icon name="waveform" size={26} />}
                  <span className="mc-badge kind">
                    <Icon name={KIND_ICON[m.kind]} size={11} />
                  </span>
                  {m.kind !== 'image' && <span className="mc-badge dur">{formatTime(m.duration).replace(/^00:/, '0:')}</span>}
                  {n > 0 && (
                    <span className="mc-badge used" title={`Se usa ${n} ${n === 1 ? 'vez' : 'veces'} en la línea de tiempo`}>
                      <Icon name="check" size={11} />
                      {n > 1 && n}
                    </span>
                  )}
                  <span className="mc-tools">
                    <button aria-label="Más opciones" title="Más opciones" onClick={() => void menu(m)} onDoubleClick={(e) => e.stopPropagation()}>
                      <Icon name="ellipsis" size={13} />
                    </button>
                    <button
                      aria-label={m.kind === 'audio' ? 'Usar como música' : 'Agregar al final del video'}
                      title={m.kind === 'audio' ? 'Usar como música de fondo' : 'Agregar al final del video'}
                      onClick={() => (m.kind === 'audio' ? onSetMusic(m) : onAddClip(m))}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  </span>
                  {st.proxy !== undefined && (
                    <div className="mc-progress">
                      <div style={{ width: `${st.proxy * 100}%` }} />
                    </div>
                  )}
                </div>
                <div className="mc-name">{m.name}</div>
                <div className="mc-meta">
                  {st.proxy !== undefined ? (
                    <span className="busy">Preparando…</span>
                  ) : st.transcribing ? (
                    <span className="busy">Transcribiendo…</span>
                  ) : (
                    <>
                      <span>{isLogo ? 'Logo' : KIND_LABEL[m.kind]}</span>
                      {transcript && (
                        <span className="ok" title="La voz ya está transcrita">
                          · Transcrito
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {project.media.length > 0 && <p className="bin-tip">Arrastra a una pista o haz doble clic para agregar al final. Clic derecho para más opciones.</p>}
    </div>
  )
}
