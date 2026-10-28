import { useEffect, useState } from 'react'
import type { Corner, Fit, FormatId, Project, TextItem } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { FONTS } from './overlays'
import { clamp, clipDur, findMedia, formatTime, mapClip, mapText, MIN_CLIP, type Selection, type Update } from './util'

interface Props {
  project: Project
  sel: Selection
  update: Update
  onSplit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/** Campo numérico que deja escribir libremente y aplica el valor al salir o con Enter. */
function NumberField({ label, value, onChange, step = 0.1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => setDraft(value.toFixed(2)), [value])
  const commit = () => {
    const v = Number(draft.replace(',', '.'))
    if (Number.isFinite(v)) onChange(clamp(v, min ?? -Infinity, max ?? Infinity))
    else setDraft(value.toFixed(2))
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

function Range({ label, value, onChange, min, max, step, display }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; display: string }) {
  return (
    <label className="field range">
      <span>
        {label} <b>{display}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

const pct = (v: number) => `${Math.round(v * 100)} %`

function ClipPanel({ project, id, update, onSplit, onDuplicate, onDelete }: Omit<Props, 'sel'> & { id: string }) {
  const clip = project.clips.find((c) => c.id === id)
  if (!clip) return null
  const m = findMedia(project, clip.mediaId)
  const set = (fn: Parameters<typeof mapClip>[2], key?: string) => update((p) => mapClip(p, id, fn), key)
  const isVideo = m?.kind === 'video'
  return (
    <>
      <h3>{isVideo ? 'Clip de video' : 'Foto'}</h3>
      <p className="file-name" title={m?.path}>
        {m?.name ?? 'Archivo no encontrado'}
      </p>
      {isVideo ? (
        <>
          <div className="row">
            <NumberField label="Desde (s)" value={clip.in} min={0} max={clip.out - MIN_CLIP} onChange={(v) => set((c) => ({ ...c, in: v }))} />
            <NumberField label="Hasta (s)" value={clip.out} min={clip.in + MIN_CLIP} max={m.duration} onChange={(v) => set((c) => ({ ...c, out: v }))} />
          </div>
          <p className="muted small">
            Usas {formatTime(clipDur(clip))} de {formatTime(m.duration)}. También puedes recortar arrastrando los bordes del clip.
          </p>
          {m.hasAudio ? (
            <Range label="Volumen" min={0} max={2} step={0.05} value={clip.volume} display={pct(clip.volume)} onChange={(v) => set((c) => ({ ...c, volume: v }), `vol-${id}`)} />
          ) : (
            <p className="muted small">Este video no tiene sonido.</p>
          )}
        </>
      ) : (
        <NumberField label="Duración en pantalla (s)" value={clip.out} min={MIN_CLIP} onChange={(v) => set((c) => ({ ...c, in: 0, out: v }))} />
      )}
      <div className="buttons">
        <button onClick={onSplit}>✂ Dividir en el cursor</button>
        <button onClick={onDuplicate}>Duplicar</button>
        <button className="danger" onClick={onDelete}>
          Eliminar
        </button>
      </div>
    </>
  )
}

const POSITIONS: [string, number][] = [
  ['Arriba', 0.15],
  ['Centro', 0.5],
  ['Abajo', 0.8]
]

function TextPanel({ project, id, update, onDelete }: Omit<Props, 'sel'> & { id: string }) {
  const t = project.texts.find((x) => x.id === id)
  if (!t) return null
  const set = (patch: Partial<TextItem>, key?: string) => update((p) => mapText(p, id, (x) => ({ ...x, ...patch })), key)
  const bg = t.backgroundColor.slice(0, 7)
  return (
    <>
      <h3>Texto</h3>
      <label className="field">
        <span>Contenido</span>
        <textarea rows={3} value={t.text} onChange={(e) => set({ text: e.target.value }, `txt-${id}`)} />
      </label>
      <div className="row">
        <label className="field">
          <span>Letra</span>
          <select value={t.font} onChange={(e) => set({ font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field color">
          <span>Color</span>
          <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value }, `color-${id}`)} />
        </label>
      </div>
      <Range label="Tamaño" min={0.02} max={0.2} step={0.005} value={t.size} display={`${Math.round(t.size * 1000) / 10}`} onChange={(v) => set({ size: v }, `size-${id}`)} />
      <div className="checks">
        <label>
          <input type="checkbox" checked={t.bold} onChange={(e) => set({ bold: e.target.checked })} /> Negrita
        </label>
        <label>
          <input type="checkbox" checked={t.outline} onChange={(e) => set({ outline: e.target.checked })} /> Borde
        </label>
        <label>
          <input type="checkbox" checked={t.background} onChange={(e) => set({ background: e.target.checked })} /> Fondo
        </label>
        {t.background && (
          <input
            type="color"
            value={bg}
            title="Color del fondo (se aplica semitransparente)"
            onChange={(e) => set({ backgroundColor: `${e.target.value}bb` }, `bg-${id}`)}
          />
        )}
      </div>
      <div className="field">
        <span>Posición (también puedes arrastrarlo en la vista previa)</span>
        <div className="segmented">
          {POSITIONS.map(([label, y]) => (
            <button key={label} className={Math.abs(t.y - y) < 0.01 && Math.abs(t.x - 0.5) < 0.01 ? 'on' : ''} onClick={() => set({ x: 0.5, y })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <NumberField label="Aparece (s)" value={t.start} min={0} max={t.end - MIN_CLIP} onChange={(v) => set({ start: v })} />
        <NumberField label="Desaparece (s)" value={t.end} min={t.start + MIN_CLIP} onChange={(v) => set({ end: v })} />
      </div>
      <div className="buttons">
        <button className="danger" onClick={onDelete}>
          Eliminar texto
        </button>
      </div>
    </>
  )
}

function MusicPanel({ project, update }: Pick<Props, 'project' | 'update'>) {
  const music = project.music
  if (!music) return null
  const m = findMedia(project, music.mediaId)
  return (
    <>
      <h3>Música de fondo</h3>
      <p className="file-name">{m?.name}</p>
      <Range label="Volumen" min={0} max={1.5} step={0.05} value={music.volume} display={pct(music.volume)} onChange={(v) => update((p) => ({ ...p, music: p.music && { ...p.music, volume: v } }), 'music-vol')} />
      <div className="checks">
        <label>
          <input type="checkbox" checked={music.fadeOut} onChange={(e) => update((p) => ({ ...p, music: p.music && { ...p.music, fadeOut: e.target.checked } }))} />
          Bajar el volumen al final (2 s)
        </label>
      </div>
      <p className="muted small">La música empieza con el video y se corta cuando termina el último clip.</p>
      <div className="buttons">
        <button className="danger" onClick={() => update((p) => ({ ...p, music: null }))}>
          Quitar música
        </button>
      </div>
    </>
  )
}

const CORNERS: [Corner, string][] = [
  ['top-left', '↖'],
  ['top-right', '↗'],
  ['bottom-left', '↙'],
  ['bottom-right', '↘']
]

function LogoPanel({ project, update }: Pick<Props, 'project' | 'update'>) {
  const logo = project.logo
  if (!logo) return null
  const set = (patch: Partial<typeof logo>, key?: string) => update((p) => ({ ...p, logo: p.logo && { ...p.logo, ...patch } }), key)
  return (
    <>
      <h3>Logo</h3>
      <p className="file-name">{findMedia(project, logo.mediaId)?.name}</p>
      <div className="field">
        <span>Esquina</span>
        <div className="segmented">
          {CORNERS.map(([c, icon]) => (
            <button key={c} className={logo.corner === c ? 'on' : ''} onClick={() => set({ corner: c })}>
              {icon}
            </button>
          ))}
        </div>
      </div>
      <Range label="Tamaño" min={0.05} max={0.5} step={0.01} value={logo.size} display={pct(logo.size)} onChange={(v) => set({ size: v }, 'logo-size')} />
      <Range label="Opacidad" min={0.1} max={1} step={0.05} value={logo.opacity} display={pct(logo.opacity)} onChange={(v) => set({ opacity: v }, 'logo-op')} />
      <p className="muted small">El logo se ve durante todo el video.</p>
      <div className="buttons">
        <button className="danger" onClick={() => update((p) => ({ ...p, logo: null }))}>
          Quitar logo
        </button>
      </div>
    </>
  )
}

function ProjectPanel({ project, update }: Pick<Props, 'project' | 'update'>) {
  return (
    <>
      <h3>Proyecto</h3>
      <div className="field">
        <span>Formato</span>
        <div className="formats">
          {(Object.keys(FORMATS) as FormatId[]).map((f) => {
            const { width, height, label } = FORMATS[f]
            const s = 26 / Math.max(width, height)
            return (
              <button key={f} className={project.format === f ? 'on' : ''} onClick={() => update((p) => ({ ...p, format: f }))} title={label}>
                <i style={{ width: width * s, height: height * s }} />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="field">
        <span>Si el video no tiene la misma forma</span>
        <div className="segmented">
          {(
            [
              ['cover', 'Llenar el cuadro'],
              ['contain', 'Mostrar completo']
            ] as [Fit, string][]
          ).map(([f, label]) => (
            <button key={f} className={project.fit === f ? 'on' : ''} onClick={() => update((p) => ({ ...p, fit: f }))}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted small">{project.fit === 'cover' ? 'Recorta los bordes que sobran.' : 'Agrega franjas negras.'}</p>
      </div>
      <h4>Atajos</h4>
      <ul className="shortcuts">
        <li>
          <kbd>Espacio</kbd> reproducir / pausar
        </li>
        <li>
          <kbd>S</kbd> dividir el clip en el cursor
        </li>
        <li>
          <kbd>Supr</kbd> eliminar lo seleccionado
        </li>
        <li>
          <kbd>←</kbd> <kbd>→</kbd> mover un cuadro (con <kbd>⇧</kbd>, un segundo)
        </li>
        <li>
          <kbd>{window.api.platform === 'darwin' ? '⌘' : 'Ctrl'} Z</kbd> deshacer
        </li>
      </ul>
    </>
  )
}

export function Inspector(props: Props) {
  const { sel } = props
  return (
    <aside className="inspector">
      {sel?.kind === 'clip' ? (
        <ClipPanel {...props} id={sel.id} />
      ) : sel?.kind === 'text' ? (
        <TextPanel {...props} id={sel.id} />
      ) : sel?.kind === 'music' ? (
        <MusicPanel {...props} />
      ) : sel?.kind === 'logo' ? (
        <LogoPanel {...props} />
      ) : (
        <ProjectPanel {...props} />
      )}
    </aside>
  )
}
