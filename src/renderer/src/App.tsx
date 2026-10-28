import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem, Project } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { useHistory } from './history'
import { Inspector } from './Inspector'
import { MediaBin } from './MediaBin'
import { renderOverlayLayers } from './overlays'
import { Player } from './player'
import { Preview } from './Preview'
import { Timeline } from './Timeline'
import { emptyProject, newClip, newText, splitAt, totalDuration, uid, type Selection } from './util'

type ExportState =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'running'; ratio: number }
  | { phase: 'done'; path: string }
  | { phase: 'error'; message: string }

const isTyping = (el: Element | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

export default function App() {
  const { project, update, undo, redo, reset, canUndo, canRedo } = useHistory(emptyProject)
  const player = useMemo(() => new Player(project), [])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState<Selection>(null)
  const [pps, setPps] = useState(60)
  const [path, setPath] = useState<string | null>(null)
  const [saved, setSaved] = useState<Project>(project)
  const [notice, setNotice] = useState<string | null>(null)
  const [exp, setExp] = useState<ExportState>({ phase: 'idle' })
  const noticeTimer = useRef<number>(0)

  const dirty = project !== saved
  const total = totalDuration(project)

  useEffect(() => {
    player.setProject(project)
  }, [player, project])
  useEffect(() => {
    player.onStop = () => setPlaying(false)
    return () => player.dispose()
  }, [player])

  useEffect(() => {
    document.title = `${path ? baseName(path) : 'Proyecto nuevo'}${dirty ? ' •' : ''} — Editor de Video`
  }, [path, dirty])

  // Si lo seleccionado desaparece (deshacer, borrar), se quita la selección.
  useEffect(() => {
    if (!sel) return
    const exists =
      sel.kind === 'clip' ? project.clips.some((c) => c.id === sel.id) : sel.kind === 'text' ? project.texts.some((t) => t.id === sel.id) : sel.kind === 'music' ? !!project.music : !!project.logo
    if (!exists) setSel(null)
  }, [project, sel])

  const notify = useCallback((msg: string) => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])

  const seek = useCallback(
    (t: number) => {
      player.seek(t)
      setTime(player.time)
    },
    [player]
  )

  const togglePlay = useCallback(() => {
    if (player.playing) player.pause()
    else player.play()
    setPlaying(player.playing)
  }, [player])

  const pause = () => {
    player.pause()
    setPlaying(false)
  }

  // --- Archivos ---
  const addMedia = useCallback(
    (items: MediaItem[], rejected: number) => {
      if (rejected > 0) notify(`${rejected} archivo(s) no se pudieron leer.`)
      if (!items.length) return
      update((p) => {
        // Si la línea de tiempo está vacía, los videos y fotos importados entran directo en ella.
        const clips = p.clips.length ? p.clips : items.filter((m) => m.kind !== 'audio').map(newClip)
        const firstAudio = items.find((m) => m.kind === 'audio')
        const music = p.music ?? (firstAudio ? { mediaId: firstAudio.id, volume: 0.6, fadeOut: true } : null)
        return { ...p, media: [...p.media, ...items], clips, music }
      })
    },
    [notify, update]
  )

  const importFiles = useCallback(async () => {
    const items = await window.api.pickMedia()
    addMedia(items, 0)
  }, [addMedia])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    notify('Leyendo archivos…')
    const items = await window.api.probePaths(paths)
    addMedia(items, paths.length - items.length)
  }

  const addClip = (m: MediaItem) => {
    const c = newClip(m)
    update((p) => ({ ...p, clips: [...p.clips, c] }))
    setSel({ kind: 'clip', id: c.id })
  }

  const removeMedia = (m: MediaItem) => {
    update((p) => ({
      ...p,
      media: p.media.filter((x) => x.id !== m.id),
      clips: p.clips.filter((c) => c.mediaId !== m.id),
      music: p.music?.mediaId === m.id ? null : p.music,
      logo: p.logo?.mediaId === m.id ? null : p.logo
    }))
  }

  // --- Edición ---
  const split = useCallback(() => {
    const res = splitAt(project, player.time)
    if (!res) return notify('Pon el cursor dentro de un clip, lejos de sus bordes, para dividirlo.')
    update(() => res.project)
    setSel({ kind: 'clip', id: res.newId })
  }, [project, player, update, notify])

  const duplicate = () => {
    if (sel?.kind !== 'clip') return
    const i = project.clips.findIndex((c) => c.id === sel.id)
    if (i < 0) return
    const copy = { ...project.clips[i], id: uid() }
    update((p) => ({ ...p, clips: [...p.clips.slice(0, i + 1), copy, ...p.clips.slice(i + 1)] }))
    setSel({ kind: 'clip', id: copy.id })
  }

  const deleteSel = useCallback(() => {
    if (!sel) return
    update((p) => {
      if (sel.kind === 'clip') return { ...p, clips: p.clips.filter((c) => c.id !== sel.id) }
      if (sel.kind === 'text') return { ...p, texts: p.texts.filter((t) => t.id !== sel.id) }
      if (sel.kind === 'music') return { ...p, music: null }
      return { ...p, logo: null }
    })
    setSel(null)
  }, [sel, update])

  const addText = () => {
    const t = newText(Math.min(player.time, Math.max(0, total - 0.5)))
    update((p) => ({ ...p, texts: [...p.texts, t] }))
    setSel({ kind: 'text', id: t.id })
  }

  // --- Proyecto ---
  const confirmDiscard = () => !dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?')

  const newProject = useCallback(() => {
    if (!confirmDiscard()) return
    pause()
    const p = emptyProject()
    reset(p)
    setSaved(p)
    setPath(null)
    setSel(null)
    seek(0)
  }, [dirty])

  const save = useCallback(
    async (saveAs: boolean) => {
      const p = project
      const out = await window.api.saveProject(p, path, saveAs)
      if (!out) return
      setPath(out)
      setSaved(p)
      notify(`Proyecto guardado: ${baseName(out)}`)
    },
    [project, path, notify]
  )

  const open = useCallback(async () => {
    if (!confirmDiscard()) return
    const res = await window.api.openProject()
    if (!res) return
    pause()
    reset(res.project)
    setSaved(res.project)
    setPath(res.path)
    setSel(null)
    seek(0)
    if (res.missing.length) notify(`No se encontraron estos archivos: ${res.missing.join(', ')}`)
  }, [dirty])

  // --- Exportar ---
  const startExport = useCallback(async () => {
    if (!project.clips.length) return notify('Agrega al menos un clip antes de exportar.')
    pause()
    const name = `${path ? baseName(path).replace(/\.[^.]+$/, '') : 'Video'} ${project.format.replace(':', 'x')}.mp4`
    const outputPath = await window.api.chooseExportPath(name)
    if (!outputPath) return
    setExp({ phase: 'preparing' })
    try {
      const overlays = await renderOverlayLayers(project)
      setExp({ phase: 'running', ratio: 0 })
      window.api.startExport({ project, overlays, outputPath })
    } catch (err) {
      setExp({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [project, path, notify])

  useEffect(
    () =>
      window.api.onExportEvent((ev) => {
        if (ev.type === 'progress') setExp({ phase: 'running', ratio: ev.ratio })
        else if (ev.type === 'done') setExp({ phase: 'done', path: ev.outputPath })
        else if (ev.type === 'error') setExp({ phase: 'error', message: ev.message })
        else setExp({ phase: 'idle' })
      }),
    []
  )

  // --- Menú y teclado ---
  const handlers = { newProject, open, save, startExport, importFiles, undo, redo }
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(
    () =>
      window.api.onMenu((cmd) => {
        const h = handlersRef.current
        if (cmd === 'undo' || cmd === 'redo') {
          if (isTyping(document.activeElement)) document.execCommand(cmd)
          else h[cmd]()
        } else if (cmd === 'new') h.newProject()
        else if (cmd === 'open') void h.open()
        else if (cmd === 'save') void h.save(false)
        else if (cmd === 'saveAs') void h.save(true)
        else if (cmd === 'import') void h.importFiles()
        else if (cmd === 'export') void h.startExport()
      }),
    []
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey || exp.phase !== 'idle') return
      const frame = e.shiftKey ? 1 : 1 / 30
      if (e.key === ' ') togglePlay()
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel()
      else if (e.key.toLowerCase() === 's') split()
      else if (e.key === 'ArrowLeft') seek(player.time - frame)
      else if (e.key === 'ArrowRight') seek(player.time + frame)
      else if (e.key === 'Home') seek(0)
      else if (e.key === 'End') seek(total)
      else if (e.key === 'Escape') setSel(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, deleteSel, split, seek, player, total, exp.phase])

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="group">
          <button onClick={newProject}>Nuevo</button>
          <button onClick={() => void open()}>Abrir</button>
          <button onClick={() => void save(false)} className={dirty ? 'dirty' : ''}>
            Guardar
          </button>
        </div>
        <div className="group">
          <button className="icon" onClick={undo} disabled={!canUndo} title="Deshacer">
            ↶
          </button>
          <button className="icon" onClick={redo} disabled={!canRedo} title="Rehacer">
            ↷
          </button>
        </div>
        <span className="title">{path ? baseName(path) : 'Proyecto nuevo'}</span>
        <select value={project.format} onChange={(e) => update((p) => ({ ...p, format: e.target.value as Project['format'] }))}>
          {Object.entries(FORMATS).map(([id, f]) => (
            <option key={id} value={id}>
              {f.label}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => void startExport()} disabled={!project.clips.length}>
          Exportar video
        </button>
      </header>

      <MediaBin
        project={project}
        sel={sel}
        onImport={() => void importFiles()}
        onAddClip={addClip}
        onSetMusic={(m) => {
          update((p) => ({ ...p, music: { mediaId: m.id, volume: p.music?.volume ?? 0.6, fadeOut: p.music?.fadeOut ?? true } }))
          setSel({ kind: 'music' })
        }}
        onSetLogo={(m) => {
          update((p) => ({ ...p, logo: { mediaId: m.id, corner: p.logo?.corner ?? 'top-right', size: p.logo?.size ?? 0.18, opacity: p.logo?.opacity ?? 0.9 } }))
          setSel({ kind: 'logo' })
        }}
        onRemove={removeMedia}
        onSelect={setSel}
      />

      <Preview
        player={player}
        project={project}
        time={time}
        playing={playing}
        sel={sel}
        onTime={setTime}
        onSelect={setSel}
        onTogglePlay={togglePlay}
        onSeek={seek}
        update={update}
      />

      <Inspector project={project} sel={sel} update={update} onSplit={split} onDuplicate={duplicate} onDelete={deleteSel} />

      <Timeline
        project={project}
        time={time}
        playing={playing}
        sel={sel}
        pps={pps}
        onZoom={setPps}
        onSelect={setSel}
        onSeek={seek}
        update={update}
        onAddText={addText}
        onSplit={split}
        onDelete={deleteSel}
      />

      {notice && <div className="toast">{notice}</div>}

      {exp.phase !== 'idle' && (
        <div className="modal-back">
          <div className="modal">
            {exp.phase === 'preparing' && <h3>Preparando textos y logo…</h3>}
            {exp.phase === 'running' && (
              <>
                <h3>Exportando video… {Math.round(exp.ratio * 100)} %</h3>
                <div className="progress">
                  <div style={{ width: `${exp.ratio * 100}%` }} />
                </div>
                <p className="muted small">
                  {FORMATS[project.format].width}×{FORMATS[project.format].height}, MP4. Puedes seguir mirando, pero no cierres la app.
                </p>
                <div className="buttons">
                  <button onClick={() => window.api.cancelExport()}>Cancelar</button>
                </div>
              </>
            )}
            {exp.phase === 'done' && (
              <>
                <h3>¡Listo!</h3>
                <p className="file-name">{baseName(exp.path)}</p>
                <div className="buttons">
                  <button className="primary" onClick={() => window.api.showInFolder(exp.path)}>
                    {window.api.platform === 'darwin' ? 'Mostrar en Finder' : 'Mostrar en la carpeta'}
                  </button>
                  <button onClick={() => setExp({ phase: 'idle' })}>Cerrar</button>
                </div>
              </>
            )}
            {exp.phase === 'error' && (
              <>
                <h3>No se pudo exportar</h3>
                <pre className="error">{exp.message}</pre>
                <div className="buttons">
                  <button onClick={() => setExp({ phase: 'idle' })}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
