import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Item, MediaItem, Project, VideoClip, Word } from '../../shared/types'
import { FORMATS } from '../../shared/types'
import { emptyProject, findItem, findMedia, itemEnd, mainTrack, newAudio, newClip, totalDuration, uid } from '../../shared/project'
import { applyOps, type Op } from '../../shared/ops'
import { AiPanel, type ChatMessage, type ClaudeState, type QuickAction } from './AiPanel'
import { clamp } from '../../shared/project'
import { Cancelled, canDecode, canEncodeH264, renderVideo, type RenderJob } from './engine/exporter'
import { Player } from './engine/player'
import { useHistory } from './history'
import { Icon } from './Icon'
import { Inspector } from './Inspector'
import { MediaBin, type MediaStatus } from './MediaBin'
import { Preview } from './Preview'
import { SettingsModal } from './SettingsModal'
import { ShortcutsModal } from './Shortcuts'
import { Timeline } from './Timeline'
import { baseName, formatTime, isTyping, MOD, useEscape, type Selection } from './util'
import { Wizard, type DraftRequest, type DraftStep } from './Wizard'

type ExportState =
  | { phase: 'idle' }
  | { phase: 'video'; ratio: number }
  | { phase: 'audio'; ratio: number }
  | { phase: 'done'; path: string }
  | { phase: 'error'; message: string }

// Lo que se ve de la ventana (paneles abiertos y alto de la línea de tiempo) se recuerda en este computador.
type Layout = { left: boolean; right: boolean; tl: number }
const LAYOUT_KEY = 'editor-video:layout'
function loadLayout(): Layout {
  const fallback = { left: true, right: true, tl: 300 }
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}')
    return {
      left: typeof saved.left === 'boolean' ? saved.left : fallback.left,
      right: typeof saved.right === 'boolean' ? saved.right : fallback.right,
      tl: Number.isFinite(saved.tl) ? clamp(saved.tl, 190, Math.max(190, window.innerHeight - 320)) : fallback.tl
    }
  } catch {
    return fallback
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function App() {
  const { project, projectRef, update, undo, redo, reset, canUndo, canRedo } = useHistory(emptyProject)
  const player = useMemo(() => new Player(project), []) // el reproductor vive mientras la ventana esté abierta
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState<Selection>(null)
  const [pps, setPps] = useState(60)
  const [path, setPath] = useState<string | null>(null)
  const [saved, setSaved] = useState<Project>(project)
  const [notice, setNotice] = useState<string | null>(null)
  const [exp, setExp] = useState<ExportState>({ phase: 'idle' })
  const [leftTab, setLeftTab] = useState<'media' | 'ai'>('media')
  const [mediaStatus, setMediaStatus] = useState<Record<string, MediaStatus>>({})
  const [claude, setClaude] = useState<ClaudeState & { path: string | null }>({ checked: false, found: false, version: null, path: null })
  const [chat, setChat] = useState<{ conversationId: string; sessionId: string | null; messages: ChatMessage[] }>(() => ({ conversationId: uid(), sessionId: null, messages: [] }))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [wizard, setWizard] = useState<{ steps: DraftStep[] | null } | null>({ steps: null })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [safe, setSafe] = useState(false)
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const fitRef = useRef<() => void>(() => {})
  const noticeTimer = useRef(0)
  const renderJob = useRef<RenderJob | null>(null)

  const dirty = project !== saved
  const total = totalDuration(project)

  useEffect(() => player.setProject(project), [player, project])
  useEffect(() => {
    player.onStop = () => setPlaying(false)
    return () => player.dispose()
  }, [player])
  useEffect(() => {
    document.title = `${path ? baseName(path) : 'Proyecto nuevo'}${dirty ? ' •' : ''} — Editor de Video`
    window.api.setDirty(dirty)
  }, [path, dirty])
  useEffect(() => window.api.setRepresentedFile(path), [path])
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
    } catch {
      // Sin almacenamiento, la ventana abre con el diseño de siempre.
    }
  }, [layout])
  const toggleLayout = (key: 'left' | 'right') => setLayout((l) => ({ ...l, [key]: !l[key] }))
  const showLeft = (tab: 'media' | 'ai') => {
    setLeftTab(tab)
    setLayout((l) => ({ ...l, left: true }))
  }
  useEffect(() => {
    if (sel && !findItem(project, sel)) setSel(null)
  }, [project, sel])

  const notify = useCallback((msg: string) => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000)
  }, [])

  // --- Claude Code ---
  const checkClaude = useCallback(async () => {
    const s = await window.api.aiStatus()
    setClaude({ checked: true, ...s })
  }, [])
  useEffect(() => {
    void checkClaude()
    // La marca guardada en ajustes se usa en los proyectos nuevos.
    void window.api.getSettings().then(({ settings }) => {
      if (projectRef.current.media.length) return
      const p = { ...projectRef.current, brand: { ...settings.brand, logoMediaId: null } }
      reset(p)
      setSaved(p)
    })
  }, [checkClaude, reset, projectRef])
  useEffect(() => window.api.onAiProgress((_id, p) => setAiStatus(p.text)), [])

  // --- Reproducción ---
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
  const pause = useCallback(() => {
    player.pause()
    setPlaying(false)
  }, [player])

  // --- Archivos ---
  const setStatus = (id: string, patch: MediaStatus | null) =>
    setMediaStatus((s) => {
      const next = { ...s }
      if (patch === null) delete next[id]
      else next[id] = { ...s[id], ...patch }
      return next
    })

  useEffect(() => window.api.onProxyProgress((id, ratio) => setStatus(id, { proxy: ratio })), [])

  /** Si el video no se puede reproducir tal cual (formato raro, HEVC sin soporte…), crea una copia para editar. */
  const prepareVideo = useCallback(
    async (m: MediaItem) => {
      if (m.kind !== 'video' || m.proxy) return
      const needs = (await window.api.needsProxy(m)) || !(await canDecode(m))
      if (!needs) return
      setStatus(m.id, { proxy: 0 })
      try {
        const proxy = await window.api.makeProxy(m)
        update((p) => ({ ...p, media: p.media.map((x) => (x.id === m.id ? { ...x, proxy } : x)) }), 'media')
      } catch (err) {
        notify(errText(err))
      } finally {
        setStatus(m.id, { proxy: undefined })
      }
    },
    [update, notify]
  )

  const addMedia = useCallback(
    (items: MediaItem[], rejected = 0) => {
      if (rejected > 0) notify(`${rejected} archivo(s) no se pudieron leer.`)
      const fresh = items.filter((m) => !projectRef.current.media.some((x) => x.path === m.path))
      if (!fresh.length) return
      const autoPlace = !wizard && mainTrack(projectRef.current).items.length === 0
      update((p) => {
        let next: Project = { ...p, media: [...p.media, ...fresh] }
        // Con la línea de tiempo vacía, los videos y fotos entran directo en fila.
        if (autoPlace) {
          const main = mainTrack(next)
          const clips = fresh.filter((m) => m.kind !== 'audio').map((m) => newClip(m))
          next = { ...next, tracks: next.tracks.map((t) => (t === main ? { ...t, items: clips } : t)) }
          const song = fresh.find((m) => m.kind === 'audio')
          if (song && clips.length) next = applyOps(next, [{ op: 'set_music', mediaId: song.id }]).project
        }
        return next
      })
      for (const m of fresh) void prepareVideo(m)
    },
    [update, notify, prepareVideo, wizard]
  )

  const importFiles = useCallback(async () => addMedia(await window.api.pickMedia()), [addMedia])

  const onDropFiles = async (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-media-id')) return
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    notify('Leyendo archivos…')
    const items = await window.api.probePaths(paths)
    setNotice(null)
    addMedia(items, paths.length - items.length)
  }

  /** Aplica órdenes (las mismas que usa Claude) como un solo paso de deshacer y avisa de los errores. */
  const run = useCallback(
    (ops: Op[], quiet = false) => {
      const res = applyOps(projectRef.current, ops)
      if (res.errors.length && !quiet) notify(res.errors[0])
      if (res.project !== projectRef.current) update(() => res.project)
      return res
    },
    [update, notify]
  )

  const addClip = (m: MediaItem) => {
    const res = run([{ op: 'add_clip', mediaId: m.id, ref: 'n' }])
    if (res.created.n) setSel(res.created.n)
  }
  const setMusic = (m: MediaItem) => {
    if (totalDuration(project) === 0) return notify('Primero agrega videos o fotos; la música se ajusta a lo que dure el video.')
    const res = run([{ op: 'set_music', mediaId: m.id, ref: 'n' }])
    if (res.created.n) setSel(res.created.n)
  }
  const setLogo = (m: MediaItem) => {
    if (totalDuration(project) === 0) return notify('Primero agrega videos o fotos.')
    const res = run([{ op: 'set_logo', mediaId: m.id, corner: 'top-right', size: 0.2, opacity: 0.9, ref: 'n' }])
    if (res.created.n) setSel(res.created.n)
  }
  const pickLogo = () => {
    const img = project.media.find((m) => m.kind === 'image')
    if (!img) return notify('Importa primero la imagen del logo (PNG con fondo transparente).')
    showLeft('media')
    notify('Haz clic derecho en la imagen que quieras usar y elige «Usar como logo».')
  }

  const removeMedia = (m: MediaItem) =>
    update((p) => ({
      ...p,
      media: p.media.filter((x) => x.id !== m.id),
      tracks: p.tracks.map((t) => ({ ...t, items: t.items.filter((i) => !('mediaId' in i) || i.mediaId !== m.id) })),
      transcripts: p.transcripts.filter((t) => t.mediaId !== m.id),
      brand: p.brand.logoMediaId === m.id ? { ...p.brand, logoMediaId: null } : p.brand
    }))

  const onDropMedia = (mediaId: string, trackId: string, at: number) => {
    const p = projectRef.current
    const m = findMedia(p, mediaId)
    const track = p.tracks.find((t) => t.id === trackId)
    if (!m || !track) return
    if (track.kind === 'main') {
      if (m.kind === 'audio') return notify('En el video principal van videos y fotos. Suelta el audio en una pista de audio.')
      let index = track.items.findIndex((i) => at < i.start + i.duration / 2)
      if (index < 0) index = track.items.length
      const res = run([{ op: 'add_clip', mediaId, index, ref: 'n' }])
      if (res.created.n) setSel(res.created.n)
      return
    }
    let item: Item
    if (track.kind === 'audio') {
      if (!m.hasAudio) return notify('Ese archivo no tiene sonido.')
      item = newAudio(m, { start: at })
    } else {
      if (m.kind === 'audio') return notify('Las capas son para imagen. Suelta el audio en una pista de audio.')
      item = newClip(m, { start: at, fit: 'contain' })
    }
    update((pr) => ({ ...pr, tracks: pr.tracks.map((t) => (t.id === trackId ? { ...t, items: [...t.items, item] } : t)) }))
    setSel(item.id)
  }

  // --- Edición ---
  const split = useCallback(() => {
    const p = projectRef.current
    const t = player.time
    let target = sel ? findItem(p, sel)?.item : undefined
    if (!target || t <= target.start || t >= itemEnd(target)) target = mainTrack(p).items.find((i) => t > i.start && t < itemEnd(i))
    if (!target) return notify('Pon el cursor dentro de un elemento para dividirlo.')
    const res = run([{ op: 'split', id: target.id, at: t, ref: 'b' }])
    if (res.created.b) setSel(res.created.b)
  }, [player, sel, run, notify])

  const duplicate = useCallback(() => {
    const found = sel ? findItem(projectRef.current, sel) : null
    if (!found) return
    const copy = { ...structuredClone(found.item), id: uid() }
    if (found.track.kind !== 'main') copy.start = itemEnd(found.item)
    update((p) => ({
      ...p,
      tracks: p.tracks.map((t) => (t.id === found.track.id ? { ...t, items: [...t.items.slice(0, found.index + 1), copy, ...t.items.slice(found.index + 1)] } : t))
    }))
    setSel(copy.id)
  }, [sel, update])

  const deleteSel = useCallback(() => {
    if (!sel) return
    run([{ op: 'remove', id: sel }], true)
    setSel(null)
  }, [sel, run])

  const addText = () => {
    const start = Math.min(player.time, Math.max(0, total - 0.5))
    const res = run([{ op: 'add_text', text: 'Escribe tu texto', start, duration: 3, anim: { in: { type: 'pop', duration: 0.4 }, out: { type: 'fade', duration: 0.3 } }, ref: 'n' }])
    if (res.created.n) setSel(res.created.n)
  }

  // --- Transcripción ---
  useEffect(
    () =>
      window.api.onTranscribeProgress((id, p) => {
        if (p.stage === 'download') setAiStatus(`Descargando el modelo de voz (solo la primera vez)… ${Math.round((p.ratio ?? 0) * 100)} %`)
        else if (p.stage === 'working') setAiStatus(`Transcribiendo «${findMedia(projectRef.current, id)?.name ?? ''}»…`)
      }),
    []
  )

  const transcribe = useCallback(
    async (m: MediaItem): Promise<Word[] | null> => {
      setStatus(m.id, { transcribing: true })
      try {
        const words = await window.api.transcribe(m)
        update((p) => ({ ...p, transcripts: [...p.transcripts.filter((t) => t.mediaId !== m.id), { mediaId: m.id, language: 'es', words }] }), 'transcripts')
        return words
      } catch (err) {
        notify(errText(err))
        return null
      } finally {
        setStatus(m.id, { transcribing: false })
      }
    },
    [update, notify]
  )

  /** Transcribe lo que tenga voz y aún no esté transcrito (los clips del video, o todo si se indica). */
  const ensureTranscripts = useCallback(
    async (all = false) => {
      const p = projectRef.current
      const used = new Set(p.tracks.flatMap((t) => t.items.filter((i) => i.type === 'video').map((i) => (i as VideoClip).mediaId)))
      const todo = p.media.filter((m) => m.kind === 'video' && m.hasAudio && (all || used.has(m.id)) && !p.transcripts.some((t) => t.mediaId === m.id))
      for (const m of todo) {
        setAiStatus(`Transcribiendo «${m.name}»…`)
        await transcribe(m)
      }
    },
    [transcribe]
  )

  // --- Claude ---
  const say = (m: ChatMessage) => setChat((c) => ({ ...c, messages: [...c.messages, m] }))

  const askClaude = useCallback(
    async (message: string, shown?: string): Promise<boolean> => {
      say({ role: 'user', text: shown ?? message })
      setAiBusy(true)
      setAiStatus('Claude está pensando…')
      try {
        const res = await window.api.aiRun({ conversationId: chat.conversationId, sessionId: chat.sessionId, project: projectRef.current, message })
        const applied = res.operations.length ? run(res.operations as Op[], true) : null
        setChat((c) => ({
          ...c,
          sessionId: res.sessionId,
          messages: [...c.messages, { role: 'assistant', text: res.reply || 'Listo.', changes: res.operations.length - (applied?.errors.length ?? 0), warnings: applied?.errors }]
        }))
        return true
      } catch (err) {
        say({ role: 'error', text: errText(err) })
        return false
      } finally {
        setAiBusy(false)
        setAiStatus('')
      }
    },
    [chat.conversationId, chat.sessionId, run]
  )

  const quick = useCallback(
    async (action: QuickAction) => {
      showLeft('ai')
      const hasCaptions = () => projectRef.current.tracks.some((t) => t.items.some((i) => i.type === 'captions'))
      if (action === 'captions' || action === 'silences') {
        setAiBusy(true)
        try {
          await ensureTranscripts()
          if (action === 'silences') {
            const before = totalDuration(projectRef.current)
            const res = run([{ op: 'cut_silences' }], true)
            if (res.errors.length) say({ role: 'error', text: 'No hay voz transcrita en los clips del video principal.' })
            else {
              if (hasCaptions()) run([{ op: 'add_captions' }], true)
              const saved = before - totalDuration(projectRef.current)
              say({
                role: 'info',
                text: saved > 0.05 ? `Listo: quité ${saved.toFixed(1)} s de silencios y muletillas. Revisa el resultado; con ${MOD}Z lo deshaces.` : 'No encontré silencios largos ni muletillas que cortar.'
              })
            }
          } else {
            const res = run([{ op: 'add_captions', preset: 'karaoke' }], true)
            say(res.errors.length ? { role: 'error', text: 'No encontré voz en los clips del video principal.' } : { role: 'info', text: 'Subtítulos listos. Selecciónalos en la línea de tiempo para cambiar el estilo.' })
          }
        } finally {
          setAiBusy(false)
          setAiStatus('')
        }
        return
      }
      setAiBusy(true)
      await ensureTranscripts(action === 'highlights')
      setAiBusy(false)
      const prompts: Record<string, [string, string]> = {
        cleanup: [
          'Revisa las transcripciones de los clips del video principal y quita (remove_ranges) frases repetidas, arranques en falso, errores y equivocaciones, dejando la versión buena de cada idea. No cortes en medio de una palabra.',
          'Quitar repeticiones y errores'
        ],
        highlights: [
          `Mira las hojas de cuadros y las transcripciones y arma con replace_main un Reel de unos 30 segundos con los mejores momentos: gancho fuerte al inicio, ritmo ágil, cierre claro. Agrega un texto de gancho animado al inicio y transiciones suaves. Formato ${projectRef.current.format}.`,
          'Reel con los mejores momentos'
        ],
        rhythm: [
          'Dale ritmo al video sin cambiar el contenido: animaciones de entrada a los textos, transiciones cortas variadas entre clips, Ken Burns suave en las fotos, y un texto de gancho al inicio si no lo hay.',
          'Darle ritmo y animaciones'
        ],
        copy: ['Escribe con set_copy un título, una descripción para Instagram/TikTok (con llamada a la acción) y 8 a 12 hashtags relevantes para este video.', 'Título, descripción y hashtags']
      }
      const [msg, label] = prompts[action]
      const ok = await askClaude(msg, label)
      if (ok && action === 'highlights' && hasCaptions()) run([{ op: 'add_captions' }], true)
    },
    [ensureTranscripts, run, askClaude]
  )

  const newChat = () => setChat({ conversationId: uid(), sessionId: null, messages: [] })

  // --- Asistente de inicio ---
  const createDraft = async (req: DraftRequest) => {
    const steps: DraftStep[] = [
      { label: 'Preparando archivos', state: 'running' },
      { label: 'Transcribiendo la voz', state: 'pending' },
      { label: 'Claude arma el video', state: 'pending' },
      { label: 'Toques finales', state: 'pending' }
    ]
    const setStep = (i: number, patch: Partial<DraftStep>) => {
      steps[i] = { ...steps[i], ...patch }
      setWizard({ steps: [...steps] })
    }
    setWizard({ steps: [...steps] })
    update((p) => ({ ...p, format: req.format }))
    try {
      for (const m of projectRef.current.media) await prepareVideo(m)
      setStep(0, { state: 'done' })
      setStep(1, { state: 'running' })
      await ensureTranscripts(true)
      setStep(1, { state: 'done' })
      setStep(2, { state: 'running', detail: 'esto toma un minuto o dos' })
      const parts = [
        'Arma el PRIMER BORRADOR de este video desde cero.',
        `Objetivo: ${req.goal.trim() || 'un video atractivo para redes sociales con este material'}.`,
        `Formato ${req.format}${req.seconds ? `, duración objetivo de unos ${req.seconds} segundos` : ''}.`,
        'Usa replace_main para el montaje (elige los mejores tramos de cada archivo, sin silencios ni muletillas, con gancho en los primeros 2 segundos).',
        'Agrega textos animados donde sumen (gancho al inicio y cierre con llamada a la acción), transiciones cortas y movimiento suave en las fotos.',
        req.musicId ? `Pon de música el archivo ${req.musicId} con set_music (volumen 0.35 si hay voz, 0.7 si no).` : '',
        req.logoId ? `Pon el logo ${req.logoId} con set_logo en una esquina superior.` : '',
        'No agregues subtítulos (la app los pone después). Termina con set_copy: título, descripción con llamada a la acción y hashtags.'
      ]
      const ok = await askClaude(parts.filter(Boolean).join('\n'), `Primer borrador: ${req.goal.trim() || 'video para redes'}`)
      if (!ok) throw new Error('Claude no pudo armar el borrador. Mira el mensaje en la pestaña IA.')
      setStep(2, { state: 'done', detail: undefined })
      setStep(3, { state: 'running' })
      if (req.cutSilences) run([{ op: 'cut_silences' }], true)
      if (req.captions) run([{ op: 'add_captions', preset: 'karaoke' }], true)
      if (req.musicId && !projectRef.current.tracks.some((t) => t.kind === 'audio' && t.items.length)) run([{ op: 'set_music', mediaId: req.musicId, volume: 0.4 }], true)
      setStep(3, { state: 'done' })
      seek(0)
      showLeft('ai')
    } catch (err) {
      const i = steps.findIndex((s) => s.state === 'running')
      if (i >= 0) setStep(i, { state: 'error', detail: errText(err) })
    }
  }

  // --- Proyecto ---
  const confirmDiscard = async () =>
    !dirty ||
    (await window.api.confirm({
      message: '¿Descartar los cambios sin guardar?',
      detail: 'El proyecto tiene cambios que no se han guardado. Si sigues, se pierden.',
      confirm: 'Descartar cambios',
      destructive: true
    }))

  const newProject = useCallback(
    async (withWizard: boolean) => {
      if (!(await confirmDiscard())) return
      pause()
      const { settings } = await window.api.getSettings()
      const p = { ...emptyProject(), brand: { ...settings.brand, logoMediaId: null } }
      reset(p)
      setSaved(p)
      setPath(null)
      setSel(null)
      seek(0)
      newChat()
      setWizard(withWizard ? { steps: null } : null)
    },
    [dirty, pause, reset, seek] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const save = useCallback(
    async (saveAs: boolean) => {
      const p = projectRef.current
      const out = await window.api.saveProject(p, path, saveAs)
      if (!out) return
      setPath(out)
      setSaved(p)
      notify(`Proyecto guardado: ${baseName(out)}`)
    },
    [path, notify]
  )

  const open = useCallback(async () => {
    if (!(await confirmDiscard())) return
    try {
      const res = await window.api.openProject()
      if (!res) return
      pause()
      reset(res.project)
      setSaved(res.project)
      setPath(res.path)
      setSel(null)
      setWizard(null)
      newChat()
      seek(0)
      if (res.missing.length) notify(`No se encontraron estos archivos: ${res.missing.join(', ')}`)
      for (const m of res.project.media) void prepareVideo(m)
    } catch (err) {
      notify(errText(err))
    }
  }, [dirty, pause, reset, seek, notify, prepareVideo]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Exportar ---
  const startExport = useCallback(async () => {
    const p = projectRef.current
    if (totalDuration(p) <= 0) return notify('Agrega al menos un clip antes de exportar.')
    if (Object.values(mediaStatus).some((s) => s.proxy !== undefined)) return notify('Espera a que terminen de prepararse los archivos.')
    pause()
    const name = `${path ? baseName(path).replace(/\.[^.]+$/, '') : 'Video'} ${p.format.replace(':', 'x')}.mp4`
    const outputPath = await window.api.chooseExportPath(name)
    if (!outputPath) return
    const job: RenderJob = { cancelled: false }
    renderJob.current = job
    setExp({ phase: 'video', ratio: 0 })
    try {
      const h264 = await canEncodeH264(p)
      await window.api.exportBegin(!h264)
      await renderVideo(p, h264, (pos, data) => window.api.exportChunk(pos, data), (r) => setExp({ phase: 'video', ratio: r }), job)
      setExp({ phase: 'audio', ratio: 0 })
      window.api.exportFinish({ videoPath: '', h264, project: p, outputPath })
    } catch (err) {
      window.api.exportAbort()
      setExp(err instanceof Cancelled ? { phase: 'idle' } : { phase: 'error', message: errText(err) })
    } finally {
      renderJob.current = null
    }
  }, [path, notify, pause, mediaStatus])

  const cancelExport = () => {
    if (renderJob.current) renderJob.current.cancelled = true
    window.api.exportAbort()
  }

  useEffect(
    () =>
      window.api.onExportEvent((ev) => {
        if (ev.type === 'progress') setExp({ phase: 'audio', ratio: ev.ratio })
        else if (ev.type === 'done') setExp({ phase: 'done', path: ev.outputPath })
        else if (ev.type === 'error') setExp({ phase: 'error', message: ev.message })
        else setExp({ phase: 'idle' })
      }),
    []
  )

  // --- Menú y teclado ---
  const zoomBy = (f: number) => setPps((p) => clamp(p * f, 8, 300))
  const handlers = { newProject, open, save, startExport, importFiles, undo, redo, duplicate, zoomBy, toggleLayout, showLeft }
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  // Con una ventana encima, el menú no toca el proyecto de atrás. Desde el asistente sí se puede importar o abrir.
  const modalRef = useRef<'none' | 'wizard' | 'blocking'>('none')
  modalRef.current =
    settingsOpen || shortcutsOpen || exp.phase !== 'idle' || wizard?.steps ? 'blocking' : wizard ? 'wizard' : 'none'

  useEffect(
    () =>
      window.api.onMenu((cmd) => {
        const h = handlersRef.current
        const typing = isTyping(document.activeElement)
        const modal = modalRef.current
        if (modal !== 'none' && !(typing && (cmd === 'undo' || cmd === 'redo')) && !(modal === 'wizard' && ['import', 'open', 'settings', 'shortcuts'].includes(cmd))) return
        if (cmd === 'undo' || cmd === 'redo') {
          if (typing) document.execCommand(cmd)
          else h[cmd]()
        } else if (cmd === 'new') void h.newProject(true)
        else if (cmd === 'open') void h.open()
        else if (cmd === 'save') void h.save(false)
        else if (cmd === 'saveAs') void h.save(true)
        else if (cmd === 'import') void h.importFiles()
        else if (cmd === 'export') void h.startExport()
        else if (cmd === 'duplicate') {
          if (isTyping(document.activeElement)) return
          h.duplicate()
        } else if (cmd === 'zoomIn') h.zoomBy(1.4)
        else if (cmd === 'zoomOut') h.zoomBy(1 / 1.4)
        else if (cmd === 'zoomFit') fitRef.current()
        else if (cmd === 'panelMedia') h.showLeft('media')
        else if (cmd === 'panelAi') h.showLeft('ai')
        else if (cmd === 'toggleSidebar') h.toggleLayout('left')
        else if (cmd === 'toggleInspector') h.toggleLayout('right')
        else if (cmd === 'safe') setSafe((v) => !v)
        else if (cmd === 'shortcuts') setShortcutsOpen(true)
        else if (cmd === 'settings') setSettingsOpen(true)
      }),
    []
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement) || e.altKey || exp.phase !== 'idle' || wizard || settingsOpen || shortcutsOpen) return
      if (e.metaKey || e.ctrlKey) return
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
  }, [togglePlay, deleteSel, split, seek, player, total, exp.phase, wizard, settingsOpen, shortcutsOpen])

  const exporting = exp.phase === 'video' || exp.phase === 'audio'
  useEscape(exp.phase === 'done' || exp.phase === 'error' ? () => setExp({ phase: 'idle' }) : exporting ? cancelExport : null)

  const exportRatio = exp.phase === 'video' ? exp.ratio * 0.92 : exp.phase === 'audio' ? 0.92 + exp.ratio * 0.08 : 1

  return (
    <div
      className={`app ${layout.left ? '' : 'no-left'} ${layout.right ? '' : 'no-right'}`}
      style={{ '--left': layout.left ? '300px' : '0px', '--right': layout.right ? '300px' : '0px', '--tl': `${layout.tl}px` } as React.CSSProperties}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropFiles}
    >
      <header className="topbar">
        <div className="tb-group">
          <button className="plain icon" onClick={() => toggleLayout('left')} title="Mostrar u ocultar la barra lateral" aria-label="Barra lateral" aria-pressed={layout.left}>
            <Icon name="sidebarLeft" size={17} />
          </button>
        </div>
        <span className="tb-sep" />
        <div className="tb-group">
          <button className="plain" onClick={() => void newProject(true)} title={`Proyecto nuevo con el asistente de Claude (${MOD}N)`}>
            <Icon name="sparkles" size={16} /> Nuevo
          </button>
          <button className="plain icon" onClick={() => void open()} title={`Abrir proyecto (${MOD}O)`} aria-label="Abrir proyecto">
            <Icon name="folder" size={17} />
          </button>
          <button className="plain icon" onClick={() => void save(false)} title={`Guardar (${MOD}S)`} aria-label="Guardar">
            <Icon name="save" size={17} />
          </button>
          <button className="plain icon" onClick={() => void importFiles()} title={`Importar archivos (${MOD}I)`} aria-label="Importar archivos">
            <Icon name="import" size={17} />
          </button>
        </div>
        <span className="tb-sep" />
        <div className="tb-group">
          <button className="plain icon" onClick={undo} disabled={!canUndo} title={`Deshacer (${MOD}Z)`} aria-label="Deshacer">
            <Icon name="undo" size={17} />
          </button>
          <button className="plain icon" onClick={redo} disabled={!canRedo} title="Rehacer" aria-label="Rehacer">
            <Icon name="redo" size={17} />
          </button>
        </div>
        <div className="tb-title">
          <b>{path ? baseName(path).replace(/\.edvideo$/, '') : 'Proyecto nuevo'}</b>
          <span>
            {dirty ? <span className="edited">Editado</span> : path ? 'Guardado' : 'Sin guardar'}
            {total > 0 && ` · ${formatTime(total)}`}
          </span>
        </div>
        <select value={project.format} title="Formato del video" aria-label="Formato del video" onChange={(e) => update((p) => ({ ...p, format: e.target.value as Project['format'] }))}>
          {Object.entries(FORMATS).map(([id, f]) => (
            <option key={id} value={id}>
              {f.label.replace(/ \(.*\)$/, '')}
            </option>
          ))}
        </select>
        <div className="tb-group">
          <button className="plain icon" title={`Ajustes (${MOD},)`} aria-label="Ajustes" onClick={() => setSettingsOpen(true)}>
            <Icon name="gear" size={17} />
          </button>
          <button className="plain icon" onClick={() => toggleLayout('right')} title={`Mostrar u ocultar el inspector (${MOD}4)`} aria-label="Inspector" aria-pressed={layout.right}>
            <Icon name="sidebarRight" size={17} />
          </button>
        </div>
        <button className="primary" onClick={() => void startExport()} disabled={total <= 0} title={`Exportar video (${MOD}E)`}>
          <Icon name="share" size={15} /> Exportar
        </button>
      </header>

      <aside className="left">
        <div className="tabs big">
          <button className={leftTab === 'media' ? 'on' : ''} onClick={() => setLeftTab('media')}>
            Archivos
          </button>
          <button className={leftTab === 'ai' ? 'on' : ''} onClick={() => setLeftTab('ai')}>
            Asistente IA {aiBusy && <span className="dot" />}
          </button>
        </div>
        {leftTab === 'media' ? (
          <MediaBin
            project={project}
            status={mediaStatus}
            onImport={() => void importFiles()}
            onAddClip={addClip}
            onSetMusic={setMusic}
            onSetLogo={setLogo}
            onTranscribe={(m) => void transcribe(m)}
            onRemove={removeMedia}
          />
        ) : (
          <AiPanel
            messages={chat.messages}
            busy={aiBusy}
            status={aiStatus}
            claude={claude}
            hasMedia={project.media.length > 0}
            onSend={(t) => void askClaude(t)}
            onCancel={() => window.api.aiCancel(chat.conversationId)}
            onQuick={(a) => void quick(a)}
            onLogin={() => window.api.aiLogin()}
            onRecheck={() => void checkClaude()}
            onNewChat={newChat}
          />
        )}
      </aside>

      <Preview
        player={player}
        project={project}
        time={time}
        playing={playing}
        sel={sel}
        safe={safe}
        onToggleSafe={() => setSafe((v) => !v)}
        onImport={() => void importFiles()}
        onTime={setTime} onSelect={setSel} onTogglePlay={togglePlay} onSeek={seek} update={update} />

      <Inspector project={project} sel={sel} time={time} update={update} onSeek={seek} onSplit={split} onDuplicate={duplicate} onDelete={deleteSel} onSetLogo={pickLogo} onShortcuts={() => setShortcutsOpen(true)} />

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
        onDropMedia={onDropMedia}
        onAddText={addText}
        onSplit={split}
        onDuplicate={duplicate}
        onDelete={deleteSel}
        height={layout.tl}
        onHeight={(tl) => setLayout((l) => ({ ...l, tl }))}
        fitRef={fitRef}
      />

      {notice && (
        <div className="toast" role="status">
          <Icon name="info" size={15} />
          {notice}
        </div>
      )}

      {wizard && (
        <Wizard
          media={project.media}
          claudeReady={claude.found}
          steps={wizard.steps}
          onImport={() => void importFiles()}
          onCreate={(r) => void createDraft(r)}
          onClose={() => setWizard(null)}
        />
      )}

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {settingsOpen && <SettingsModal claude={claude.checked ? claude : null} onRecheck={() => void checkClaude()} onLogin={() => window.api.aiLogin()} onClose={() => setSettingsOpen(false)} />}

      {exp.phase !== 'idle' && (
        <div className="modal-back">
          <div className="modal center" role="dialog">
            {exporting && (
              <>
                <div className="big-icon">
                  <Icon name="share" size={24} />
                </div>
                <h2>{exp.phase === 'video' ? 'Exportando la imagen…' : 'Mezclando el audio…'}</h2>
                <p className="lead">
                  {Math.round(exportRatio * 100)} % · {FORMATS[project.format].width}×{FORMATS[project.format].height}, MP4 a 30 cuadros por segundo
                </p>
                <div className="progress">
                  <div style={{ width: `${exportRatio * 100}%` }} />
                </div>
                <div className="buttons">
                  <button onClick={cancelExport}>Cancelar</button>
                </div>
              </>
            )}
            {exp.phase === 'done' && (
              <>
                <div className="big-icon ok">
                  <Icon name="check" size={26} />
                </div>
                <h2>Video exportado</h2>
                <p className="lead file-name">{baseName(exp.path)}</p>
                <div className="buttons">
                  <button onClick={() => setExp({ phase: 'idle' })}>Cerrar</button>
                  <button className="primary" autoFocus onClick={() => window.api.showInFolder(exp.path)}>
                    {window.api.platform === 'darwin' ? 'Mostrar en Finder' : 'Mostrar en la carpeta'}
                  </button>
                </div>
              </>
            )}
            {exp.phase === 'error' && (
              <>
                <div className="big-icon bad">
                  <Icon name="warning" size={24} />
                </div>
                <h2>No se pudo exportar</h2>
                <pre className="error">{exp.message}</pre>
                <div className="buttons">
                  <button className="primary" autoFocus onClick={() => setExp({ phase: 'idle' })}>
                    Cerrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
