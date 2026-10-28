import { useEffect, useState } from 'react'
import type {
  AnimProp,
  AudioItem,
  CaptionsItem,
  Easing,
  FormatId,
  Item,
  Project,
  ShapeItem,
  TextItem,
  TextStyle,
  Track,
  VideoClip,
  VisualItem
} from '../../shared/types'
import { CAPTION_PRESETS, FILTER_PRESETS, FORMATS, IN_ANIMS, LOOP_ANIMS, OUT_ANIMS, TRANSITIONS } from '../../shared/types'
import { clamp, defaultFilters, findItem, findMedia, mapItem, MIN_DURATION } from '../../shared/project'
import { baseValue, upsertKeyframe } from './engine/anim'
import { FONTS } from './engine/compose'
import { formatTime, type Update } from './util'

interface Props {
  project: Project
  sel: string | null
  time: number
  update: Update
  onSeek: (t: number) => void
  onSplit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetLogo: () => void
}

// --- Controles ---

function NumberField({ label, value, onChange, step = 0.1, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => setDraft(value.toFixed(2)), [value])
  const commit = () => {
    const v = Number(draft.replace(',', '.'))
    if (Number.isFinite(v)) onChange(clamp(v, min ?? -Infinity, max ?? Infinity))
    else setDraft(value.toFixed(2))
  }
  return (
    <label className="field">
      <span>
        {label}
        {suffix && <i className="muted"> {suffix}</i>}
      </span>
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

function Range({ label, value, onChange, min, max, step, display, keyed, onKey }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; display: string; keyed?: 'on' | 'off' | 'animated'; onKey?: () => void }) {
  return (
    <div className="field range">
      <span>
        {onKey && (
          <button className={`kf-btn ${keyed ?? ''}`} onClick={onKey} title={keyed === 'off' ? 'Animar esta propiedad (agrega un keyframe aquí)' : keyed === 'on' ? 'Quitar el keyframe de este punto' : 'Agregar keyframe aquí'}>
            ◆
          </button>
        )}
        {label} <b>{display}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[] | [T, string][]; onChange: (v: T) => void }) {
  const pairs = (options as (T | [T, string])[]).map((o) => (Array.isArray(o) ? o : [o, NAMES[o] ?? o])) as [T, string][]
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {pairs.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

function Color({ label, value, onChange, alpha }: { label: string; value: string; onChange: (v: string) => void; alpha?: boolean }) {
  return (
    <label className="field color">
      <span>{label}</span>
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(alpha ? `${e.target.value}${value.slice(7, 9) || 'bb'}` : e.target.value)} />
    </label>
  )
}

const NAMES: Record<string, string> = {
  none: 'Ninguna', fade: 'Desvanecer', 'slide-up': 'Deslizar hacia arriba', 'slide-down': 'Deslizar hacia abajo', 'slide-left': 'Deslizar a la izquierda',
  'slide-right': 'Deslizar a la derecha', 'zoom-in': 'Acercar', 'zoom-out': 'Alejar', pop: 'Rebote (pop)', spin: 'Girar', blur: 'Desenfoque',
  typewriter: 'Máquina de escribir', words: 'Palabra por palabra', 'ken-burns-in': 'Ken Burns: acercar lento', 'ken-burns-out': 'Ken Burns: alejar lento',
  'pan-left': 'Paneo a la izquierda', 'pan-right': 'Paneo a la derecha', pulse: 'Latido', float: 'Flotar', shake: 'Temblor',
  'fade-black': 'Fundido a negro', zoom: 'Zoom', 'wipe-left': 'Cortina a la izquierda', 'wipe-right': 'Cortina a la derecha',
  bw: 'Blanco y negro', warm: 'Cálido', cool: 'Frío', vintage: 'Vintage', vivid: 'Vivo', cinema: 'Cine',
  karaoke: 'Karaoke (resalta la palabra)', line: 'Frase simple', bounce: 'Salto en la palabra',
  linear: 'Lineal', 'ease-in': 'Acelera', 'ease-out': 'Frena', 'ease-in-out': 'Suave', 'back-out': 'Rebote suave'
}
NAMES['pop-caption'] = 'Una palabra a la vez'
const CAPTION_NAMES: [CaptionsItem['preset'], string][] = CAPTION_PRESETS.map((p) => [p, p === 'pop' ? NAMES['pop-caption'] : NAMES[p]])

const pct = (v: number) => `${Math.round(v * 100)} %`

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([id, l]) => (
        <button key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          {l}
        </button>
      ))}
    </div>
  )
}

// --- Paneles por tipo ---

type Set<T extends Item> = (fn: (it: T) => T, key?: string) => void

function TimingFields({ item, set, track }: { item: Item; set: Set<Item>; track: Track }) {
  return (
    <div className="row">
      {track.kind !== 'main' && <NumberField label="Empieza (s)" value={item.start} min={0} onChange={(v) => set((it) => ({ ...it, start: v }))} />}
      <NumberField label="Dura (s)" value={item.duration} min={MIN_DURATION} onChange={(v) => set((it) => ({ ...it, duration: v }))} />
    </div>
  )
}

function ClipSettings({ clip, project, set, track, props }: { clip: VideoClip; project: Project; set: Set<VideoClip>; track: Track; props: Props }) {
  const m = findMedia(project, clip.mediaId)
  const isVideo = clip.type === 'video'
  const maxDur = m && isVideo ? (m.duration - clip.in) / clip.speed : Infinity
  return (
    <>
      <div className="row">
        {track.kind !== 'main' && <NumberField label="Empieza (s)" value={clip.start} min={0} onChange={(v) => set((c) => ({ ...c, start: v }))} />}
        {isVideo && <NumberField label="Desde (s del archivo)" value={clip.in} min={0} max={(m?.duration ?? 0) - MIN_DURATION} onChange={(v) => set((c) => ({ ...c, in: v, duration: Math.min(c.duration, ((m?.duration ?? 0) - v) / c.speed) }))} />}
        <NumberField label="Dura (s)" value={clip.duration} min={MIN_DURATION} max={maxDur} onChange={(v) => set((c) => ({ ...c, duration: v }))} />
      </div>
      {isVideo && (
        <>
          <Range
            label="Velocidad"
            min={0.25}
            max={4}
            step={0.05}
            value={clip.speed}
            display={`${clip.speed.toFixed(2)}×`}
            onChange={(v) => set((c) => ({ ...c, speed: v, duration: Math.min((c.duration * c.speed) / v, ((m?.duration ?? 0) - c.in) / v) }), `speed-${clip.id}`)}
          />
          <div className="chips">
            {[0.5, 1, 1.5, 2, 3].map((s) => (
              <button key={s} className={clip.speed === s ? 'on' : ''} onClick={() => set((c) => ({ ...c, speed: s, duration: Math.min((c.duration * c.speed) / s, ((m?.duration ?? 0) - c.in) / s) }))}>
                {s}×
              </button>
            ))}
          </div>
          {m?.hasAudio ? (
            <Range label="Volumen" min={0} max={2} step={0.05} value={clip.volume} display={pct(clip.volume)} onChange={(v) => set((c) => ({ ...c, volume: v }), `vol-${clip.id}`)} />
          ) : (
            <p className="muted small">Este video no tiene sonido.</p>
          )}
        </>
      )}
      <div className="field">
        <span>Encuadre</span>
        <div className="segmented">
          {(
            [
              ['cover', 'Llenar el cuadro'],
              ['contain', 'Mostrar completo']
            ] as const
          ).map(([f, l]) => (
            <button key={f} className={clip.fit === f ? 'on' : ''} onClick={() => set((c) => ({ ...c, fit: f }))}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="buttons">
        <button onClick={props.onSplit}>✂ Dividir en el cursor</button>
        <button onClick={props.onDuplicate}>Duplicar</button>
        <button className="danger" onClick={props.onDelete}>
          Eliminar
        </button>
      </div>
    </>
  )
}

const TEXT_PRESETS: [string, Partial<TextStyle>][] = [
  ['Título', { size: 0.08, bold: true, uppercase: true, outline: false, shadow: true, background: false }],
  ['Subtítulo', { size: 0.045, bold: false, uppercase: false, outline: true, shadow: false, background: false }],
  ['Etiqueta', { size: 0.04, bold: true, uppercase: true, outline: false, shadow: false, background: true }],
  ['Impacto', { size: 0.1, bold: true, uppercase: true, outline: true, shadow: true, background: false, font: 'Impact' }]
]

function StyleFields({ style, onChange }: { style: TextStyle; onChange: (patch: Partial<TextStyle>, key?: string) => void }) {
  return (
    <>
      <div className="row">
        <label className="field">
          <span>Letra</span>
          <select value={style.font} onChange={(e) => onChange({ font: e.target.value })}>
            {[...new Set([style.font, ...FONTS])].map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <Color label="Color" value={style.color} onChange={(v) => onChange({ color: v }, 'color')} />
      </div>
      <Range label="Tamaño" min={0.02} max={0.2} step={0.005} value={style.size} display={(style.size * 100).toFixed(1)} onChange={(v) => onChange({ size: v }, 'size')} />
      <div className="checks">
        <Check label="Negrita" value={style.bold} onChange={(v) => onChange({ bold: v })} />
        <Check label="Cursiva" value={style.italic} onChange={(v) => onChange({ italic: v })} />
        <Check label="MAYÚSCULAS" value={style.uppercase} onChange={(v) => onChange({ uppercase: v })} />
        <Check label="Sombra" value={style.shadow} onChange={(v) => onChange({ shadow: v })} />
      </div>
      <div className="checks">
        <Check label="Borde" value={style.outline} onChange={(v) => onChange({ outline: v })} />
        {style.outline && <input type="color" value={style.outlineColor.slice(0, 7)} onChange={(e) => onChange({ outlineColor: e.target.value }, 'oc')} />}
        <Check label="Fondo" value={style.background} onChange={(v) => onChange({ background: v })} />
        {style.background && <input type="color" value={style.backgroundColor.slice(0, 7)} onChange={(e) => onChange({ backgroundColor: `${e.target.value}bb` }, 'bg')} />}
      </div>
      <div className="field">
        <span>Alineación</span>
        <div className="segmented">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={style.align === a ? 'on' : ''} onClick={() => onChange({ align: a })}>
              {a === 'left' ? 'Izquierda' : a === 'center' ? 'Centro' : 'Derecha'}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function TextSettings({ item, set, track }: { item: TextItem; set: Set<TextItem>; track: Track }) {
  return (
    <>
      <label className="field">
        <span>Texto</span>
        <textarea rows={3} value={item.text} onChange={(e) => set((t) => ({ ...t, text: e.target.value }), `txt-${item.id}`)} />
      </label>
      <div className="chips">
        {TEXT_PRESETS.map(([name, s]) => (
          <button key={name} onClick={() => set((t) => ({ ...t, style: { ...t.style, ...s } }))}>
            {name}
          </button>
        ))}
      </div>
      <StyleFields style={item.style} onChange={(patch, key) => set((t) => ({ ...t, style: { ...t.style, ...patch } }), key && `${key}-${item.id}`)} />
      <TimingFields item={item} set={set as Set<Item>} track={track} />
    </>
  )
}

function CaptionSettings({ item, set }: { item: CaptionsItem; set: Set<CaptionsItem> }) {
  return (
    <>
      <p className="muted small">{item.words.length} palabras transcritas. Para corregir una palabra, pídeselo a Claude o vuelve a generar los subtítulos.</p>
      <Select label="Estilo" value={item.preset} options={CAPTION_NAMES} onChange={(v) => set((c) => ({ ...c, preset: v }))} />
      <div className="row">
        <Color label="Palabra activa" value={item.highlight} onChange={(v) => set((c) => ({ ...c, highlight: v }), 'hl')} />
        <NumberField label="Palabras por pantalla" value={item.maxWords} step={1} min={1} max={12} onChange={(v) => set((c) => ({ ...c, maxWords: Math.round(v) }))} />
      </div>
      <StyleFields style={item.style} onChange={(patch, key) => set((c) => ({ ...c, style: { ...c.style, ...patch } }), key && `${key}-${item.id}`)} />
    </>
  )
}

function ShapeSettings({ item, set, track }: { item: ShapeItem; set: Set<ShapeItem>; track: Track }) {
  return (
    <>
      <div className="row">
        <Select label="Forma" value={item.shape} options={[['rect', 'Rectángulo'], ['circle', 'Círculo']]} onChange={(v) => set((s) => ({ ...s, shape: v }))} />
        <Color label="Color" value={item.color} onChange={(v) => set((s) => ({ ...s, color: v }), 'shape-color')} />
      </div>
      <Range label="Ancho" min={0.02} max={1} step={0.01} value={item.w} display={pct(item.w)} onChange={(v) => set((s) => ({ ...s, w: v }), 'shape-w')} />
      <Range label="Alto" min={0.02} max={1} step={0.01} value={item.h} display={pct(item.h)} onChange={(v) => set((s) => ({ ...s, h: v }), 'shape-h')} />
      {item.shape === 'rect' && <Range label="Esquinas" min={0} max={0.5} step={0.01} value={item.radius} display={pct(item.radius)} onChange={(v) => set((s) => ({ ...s, radius: v }), 'shape-r')} />}
      <TimingFields item={item} set={set as Set<Item>} track={track} />
    </>
  )
}

function AudioSettings({ item, project, set, onDelete }: { item: AudioItem; project: Project; set: Set<AudioItem>; onDelete: () => void }) {
  const m = findMedia(project, item.mediaId)
  return (
    <>
      <div className="row">
        <NumberField label="Empieza (s)" value={item.start} min={0} onChange={(v) => set((a) => ({ ...a, start: v }))} />
        <NumberField label="Desde (s del archivo)" value={item.in} min={0} max={(m?.duration ?? 0) - MIN_DURATION} onChange={(v) => set((a) => ({ ...a, in: v }))} />
        <NumberField label="Dura (s)" value={item.duration} min={MIN_DURATION} max={(m?.duration ?? Infinity) - item.in} onChange={(v) => set((a) => ({ ...a, duration: v }))} />
      </div>
      <Range label="Volumen" min={0} max={2} step={0.05} value={item.volume} display={pct(item.volume)} onChange={(v) => set((a) => ({ ...a, volume: v }), `vol-${item.id}`)} />
      <Range label="Entrada suave" min={0} max={5} step={0.1} value={item.fadeIn} display={`${item.fadeIn.toFixed(1)} s`} onChange={(v) => set((a) => ({ ...a, fadeIn: v }), `fi-${item.id}`)} />
      <Range label="Salida suave" min={0} max={5} step={0.1} value={item.fadeOut} display={`${item.fadeOut.toFixed(1)} s`} onChange={(v) => set((a) => ({ ...a, fadeOut: v }), `fo-${item.id}`)} />
      <div className="buttons">
        <button className="danger" onClick={onDelete}>
          Quitar
        </button>
      </div>
    </>
  )
}

const PROPS: { prop: AnimProp; label: string; min: number; max: number; step: number; show: (v: number) => string }[] = [
  { prop: 'x', label: 'Horizontal', min: -0.5, max: 1.5, step: 0.005, show: (v) => pct(v) },
  { prop: 'y', label: 'Vertical', min: -0.5, max: 1.5, step: 0.005, show: (v) => pct(v) },
  { prop: 'scale', label: 'Escala', min: 0.05, max: 4, step: 0.01, show: (v) => pct(v) },
  { prop: 'rotation', label: 'Giro', min: -180, max: 180, step: 1, show: (v) => `${Math.round(v)}°` },
  { prop: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, show: (v) => pct(v) }
]

function PositionPanel({ item, set, time, onSeek }: { item: VisualItem; set: Set<VisualItem>; time: number; onSeek: (t: number) => void }) {
  const local = clamp(time - item.start, 0, item.duration)
  const inside = time >= item.start && time <= item.start + item.duration
  const allTimes = [...new Set(Object.values(item.keyframes).flatMap((k) => k?.map((x) => x.t) ?? []))].sort((a, b) => a - b)
  const prevKf = [...allTimes].reverse().find((t) => t < local - 1 / 60)
  const nextKf = allTimes.find((t) => t > local + 1 / 60)

  const change = (prop: AnimProp, v: number) =>
    set((it) => {
      const kfs = it.keyframes[prop]
      if (kfs?.length && inside) return { ...it, keyframes: { ...it.keyframes, [prop]: upsertKeyframe(kfs, local, v) } }
      return { ...it, transform: { ...it.transform, [prop]: v } }
    }, `pos-${prop}-${item.id}`)

  const toggleKey = (prop: AnimProp) =>
    set((it) => {
      const kfs = it.keyframes[prop] ?? []
      const here = kfs.findIndex((k) => Math.abs(k.t - local) < 1 / 60)
      if (here >= 0) {
        const rest = kfs.filter((_, i) => i !== here)
        const keyframes = { ...it.keyframes }
        // Al quitar el último keyframe, la propiedad queda fija en ese valor.
        if (rest.length) keyframes[prop] = rest
        else delete keyframes[prop]
        return { ...it, keyframes, transform: rest.length ? it.transform : { ...it.transform, [prop]: kfs[here].v } }
      }
      return { ...it, keyframes: { ...it.keyframes, [prop]: upsertKeyframe(kfs, local, baseValue(it, prop, local)) } }
    })

  return (
    <>
      <p className="muted small">
        ◆ anima una propiedad: pon el cursor en un momento, cambia el valor y se crea un keyframe ahí. También puedes arrastrar el elemento en la vista previa.
      </p>
      {PROPS.map(({ prop, label, min, max, step, show }) => {
        const kfs = item.keyframes[prop]
        const v = baseValue(item, prop, local)
        const keyed = !kfs?.length ? 'off' : kfs.some((k) => Math.abs(k.t - local) < 1 / 60) ? 'on' : 'animated'
        return <Range key={prop} label={label} min={min} max={max} step={step} value={v} display={show(v)} keyed={keyed} onKey={() => toggleKey(prop)} onChange={(x) => change(prop, x)} />
      })}
      {allTimes.length > 0 && (
        <div className="kf-nav">
          <button disabled={prevKf === undefined} onClick={() => prevKf !== undefined && onSeek(item.start + prevKf)}>
            ◀ Keyframe anterior
          </button>
          <button disabled={nextKf === undefined} onClick={() => nextKf !== undefined && onSeek(item.start + nextKf)}>
            Siguiente ▶
          </button>
        </div>
      )}
      {allTimes.length > 0 && (
        <KeyframeList item={item} set={set} />
      )}
      <div className="buttons">
        <button onClick={() => set((it) => ({ ...it, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }, keyframes: {} }))}>Restablecer posición</button>
      </div>
    </>
  )
}

function KeyframeList({ item, set }: { item: VisualItem; set: Set<VisualItem> }) {
  const EASES: Easing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back-out', 'bounce']
  return (
    <div className="kf-list">
      <h4>Keyframes</h4>
      {PROPS.filter((p) => item.keyframes[p.prop]?.length).map(({ prop, label, show }) => (
        <div key={prop} className="kf-prop">
          <b>{label}</b>
          {item.keyframes[prop]!.map((k, i) => (
            <div key={i} className="kf-row">
              <span>{k.t.toFixed(2)} s</span>
              <span>{show(k.v)}</span>
              <select
                value={k.ease}
                title="Curva para llegar a este keyframe"
                onChange={(e) =>
                  set((it) => ({ ...it, keyframes: { ...it.keyframes, [prop]: it.keyframes[prop]!.map((x, j) => (j === i ? { ...x, ease: e.target.value as Easing } : x)) } }))
                }
              >
                {EASES.map((ea) => (
                  <option key={ea} value={ea}>
                    {NAMES[ea] ?? ea}
                  </option>
                ))}
              </select>
              <button
                className="mini"
                title="Borrar"
                onClick={() =>
                  set((it) => {
                    const rest = it.keyframes[prop]!.filter((_, j) => j !== i)
                    const keyframes = { ...it.keyframes }
                    if (rest.length) keyframes[prop] = rest
                    else delete keyframes[prop]
                    return { ...it, keyframes }
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function AnimationPanel({ item, set }: { item: VisualItem; set: Set<VisualItem> }) {
  const isText = item.type === 'text'
  const ins = IN_ANIMS.filter((a) => isText || (a !== 'typewriter' && a !== 'words'))
  return (
    <>
      <h4>Entrada</h4>
      <div className="grid-chips">
        {ins.map((a) => (
          <button key={a} className={item.anim.in.type === a ? 'on' : ''} onClick={() => set((it) => ({ ...it, anim: { ...it.anim, in: { ...it.anim.in, type: a } } }))}>
            {NAMES[a]}
          </button>
        ))}
      </div>
      {item.anim.in.type !== 'none' && (
        <Range label="Duración" min={0.1} max={3} step={0.05} value={item.anim.in.duration} display={`${item.anim.in.duration.toFixed(2)} s`} onChange={(v) => set((it) => ({ ...it, anim: { ...it.anim, in: { ...it.anim.in, duration: v } } }), `ain-${item.id}`)} />
      )}
      <h4>Salida</h4>
      <div className="grid-chips">
        {OUT_ANIMS.map((a) => (
          <button key={a} className={item.anim.out.type === a ? 'on' : ''} onClick={() => set((it) => ({ ...it, anim: { ...it.anim, out: { ...it.anim.out, type: a } } }))}>
            {NAMES[a]}
          </button>
        ))}
      </div>
      {item.anim.out.type !== 'none' && (
        <Range label="Duración" min={0.1} max={3} step={0.05} value={item.anim.out.duration} display={`${item.anim.out.duration.toFixed(2)} s`} onChange={(v) => set((it) => ({ ...it, anim: { ...it.anim, out: { ...it.anim.out, duration: v } } }), `aout-${item.id}`)} />
      )}
      <h4>Movimiento continuo</h4>
      <div className="grid-chips">
        {LOOP_ANIMS.map((a) => (
          <button key={a} className={item.anim.loop === a ? 'on' : ''} onClick={() => set((it) => ({ ...it, anim: { ...it.anim, loop: a } }))}>
            {NAMES[a]}
          </button>
        ))}
      </div>
    </>
  )
}

function ColorPanel({ clip, set }: { clip: VideoClip; set: Set<VideoClip> }) {
  const f = clip.filters
  const setF = (patch: Partial<typeof f>, key?: string) => set((c) => ({ ...c, filters: { ...c.filters, ...patch } }), key && `${key}-${clip.id}`)
  return (
    <>
      <h4>Estilo de color</h4>
      <div className="grid-chips">
        {FILTER_PRESETS.map((p) => (
          <button key={p} className={f.preset === p ? 'on' : ''} onClick={() => setF({ preset: p })}>
            {p === 'none' ? 'Original' : p === 'fade' ? 'Lavado' : NAMES[p]}
          </button>
        ))}
      </div>
      <Range label="Brillo" min={0.3} max={2} step={0.01} value={f.brightness} display={pct(f.brightness)} onChange={(v) => setF({ brightness: v }, 'br')} />
      <Range label="Contraste" min={0.3} max={2} step={0.01} value={f.contrast} display={pct(f.contrast)} onChange={(v) => setF({ contrast: v }, 'ct')} />
      <Range label="Saturación" min={0} max={3} step={0.01} value={f.saturation} display={pct(f.saturation)} onChange={(v) => setF({ saturation: v }, 'sat')} />
      <Range label="Desenfoque" min={0} max={0.03} step={0.0005} value={f.blur} display={(f.blur * 1000).toFixed(0)} onChange={(v) => setF({ blur: v }, 'blur')} />
      <div className="buttons">
        <button onClick={() => set((c) => ({ ...c, filters: defaultFilters() }))}>Restablecer</button>
      </div>
    </>
  )
}

function TransitionPanel({ clip, set, first }: { clip: VideoClip; set: Set<VideoClip>; first: boolean }) {
  if (first) return <p className="muted small">El primer clip no tiene transición de entrada. Selecciona el clip siguiente para elegir cómo pasa de uno a otro.</p>
  return (
    <>
      <p className="muted small">Cómo se pasa del clip anterior a este.</p>
      <div className="grid-chips">
        {TRANSITIONS.map((t) => (
          <button key={t} className={clip.transition.type === t ? 'on' : ''} onClick={() => set((c) => ({ ...c, transition: { ...c.transition, type: t } }))}>
            {t === 'fade' ? 'Fundido cruzado' : NAMES[t]}
          </button>
        ))}
      </div>
      {clip.transition.type !== 'none' && (
        <Range label="Duración" min={0.1} max={2} step={0.05} value={clip.transition.duration} display={`${clip.transition.duration.toFixed(2)} s`} onChange={(v) => set((c) => ({ ...c, transition: { ...c.transition, duration: v } }), `tr-${clip.id}`)} />
      )}
    </>
  )
}

function ProjectPanel({ project, update, onSetLogo }: Pick<Props, 'project' | 'update' | 'onSetLogo'>) {
  const [copied, setCopied] = useState(false)
  const brand = project.brand
  const setBrand = (patch: Partial<typeof brand>, key?: string) => update((p) => ({ ...p, brand: { ...p.brand, ...patch } }), key)
  const copyText = [project.copy.title, project.copy.caption, project.copy.hashtags.join(' ')].filter(Boolean).join('\n\n')
  return (
    <>
      <h3>Proyecto</h3>
      <div className="field">
        <span>Formato</span>
        <div className="formats">
          {(Object.keys(FORMATS) as FormatId[]).map((f) => {
            const { width, height, label } = FORMATS[f]
            const s = 24 / Math.max(width, height)
            return (
              <button key={f} className={project.format === f ? 'on' : ''} onClick={() => update((p) => ({ ...p, format: f }))} title={label}>
                <i style={{ width: width * s, height: height * s }} />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <Color label="Color de fondo" value={project.background} onChange={(v) => update((p) => ({ ...p, background: v }), 'bgcolor')} />

      <h4>Marca</h4>
      <div className="row">
        <label className="field">
          <span>Letra</span>
          <select value={brand.font} onChange={(e) => setBrand({ font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <Color label="Principal" value={brand.primary} onChange={(v) => setBrand({ primary: v }, 'brand1')} />
        <Color label="Acento" value={brand.secondary} onChange={(v) => setBrand({ secondary: v }, 'brand2')} />
      </div>
      <button onClick={onSetLogo}>{brand.logoMediaId ? 'Cambiar logo…' : 'Poner logo…'}</button>

      <h4>Textos para publicar</h4>
      <label className="field">
        <span>Título</span>
        <input type="text" className="text" value={project.copy.title} onChange={(e) => update((p) => ({ ...p, copy: { ...p.copy, title: e.target.value } }), 'copy-title')} />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea rows={4} value={project.copy.caption} onChange={(e) => update((p) => ({ ...p, copy: { ...p.copy, caption: e.target.value } }), 'copy-caption')} />
      </label>
      <label className="field">
        <span>Hashtags</span>
        <input
          type="text"
          className="text"
          value={project.copy.hashtags.join(' ')}
          onChange={(e) => update((p) => ({ ...p, copy: { ...p.copy, hashtags: e.target.value.split(/\s+/).filter(Boolean) } }), 'copy-tags')}
        />
      </label>
      <button
        disabled={!copyText}
        onClick={() => {
          void navigator.clipboard.writeText(copyText)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? '¡Copiado!' : 'Copiar todo'}
      </button>

      <h4>Atajos</h4>
      <ul className="shortcuts">
        <li>
          <kbd>Espacio</kbd> reproducir / pausar
        </li>
        <li>
          <kbd>S</kbd> dividir en el cursor · <kbd>Supr</kbd> eliminar
        </li>
        <li>
          <kbd>←</kbd> <kbd>→</kbd> un cuadro (con <kbd>⇧</kbd>, un segundo)
        </li>
        <li>
          <kbd>{window.api.platform === 'darwin' ? '⌘' : 'Ctrl'} Z</kbd> deshacer · <kbd>{window.api.platform === 'darwin' ? '⌘' : 'Ctrl'} D</kbd> duplicar
        </li>
      </ul>
    </>
  )
}

type Tab = 'settings' | 'anim' | 'position' | 'color' | 'transition'
const TITLES: Record<Item['type'], string> = { video: 'Clip de video', image: 'Foto', text: 'Texto', shape: 'Forma', captions: 'Subtítulos', audio: 'Audio' }

export function Inspector(props: Props) {
  const { project, sel, update, time } = props
  const [tab, setTab] = useState<Tab>('settings')
  const found = sel ? findItem(project, sel) : null
  const type = found?.item.type
  const kind = found?.track.kind
  // Si la pestaña abierta no existe para lo nuevo seleccionado, vuelve a «Ajustes».
  useEffect(() => {
    const clip = type === 'video' || type === 'image'
    if (type === 'audio' || ((tab === 'color' || tab === 'transition') && !clip) || (tab === 'transition' && kind !== 'main')) setTab('settings')
  }, [type, kind, tab])

  if (!found) {
    return (
      <aside className="inspector">
        <ProjectPanel {...props} />
      </aside>
    )
  }
  const { item, track, index } = found
  const set = <T extends Item>(fn: (it: T) => T, key?: string) => update((p) => mapItem<T>(p, item.id, fn), key)
  const isClip = item.type === 'video' || item.type === 'image'
  const tabs: [Tab, string][] = [['settings', 'Ajustes']]
  if (item.type !== 'audio') tabs.push(['anim', 'Animación'], ['position', 'Posición'])
  if (isClip) tabs.push(['color', 'Color'])
  if (isClip && track.kind === 'main') tabs.push(['transition', 'Transición'])
  const name = 'mediaId' in item ? findMedia(project, item.mediaId)?.name : undefined

  return (
    <aside className="inspector">
      <h3>{TITLES[item.type]}</h3>
      {name && (
        <p className="file-name" title={name}>
          {name}
        </p>
      )}
      <p className="muted small">
        {formatTime(item.start)} → {formatTime(item.start + item.duration)} · pista «{track.name}»
      </p>
      {item.type !== 'audio' && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {item.type === 'audio' ? (
        <AudioSettings item={item} project={project} set={set as Set<AudioItem>} onDelete={props.onDelete} />
      ) : tab === 'anim' ? (
        <AnimationPanel item={item} set={set as Set<VisualItem>} />
      ) : tab === 'position' ? (
        <PositionPanel item={item} set={set as Set<VisualItem>} time={time} onSeek={props.onSeek} />
      ) : tab === 'color' && isClip ? (
        <ColorPanel clip={item} set={set as Set<VideoClip>} />
      ) : tab === 'transition' && isClip ? (
        <TransitionPanel clip={item} set={set as Set<VideoClip>} first={index === 0} />
      ) : isClip ? (
        <ClipSettings clip={item} project={project} set={set as Set<VideoClip>} track={track} props={props} />
      ) : item.type === 'text' ? (
        <TextSettings item={item} set={set as Set<TextItem>} track={track} />
      ) : item.type === 'captions' ? (
        <CaptionSettings item={item} set={set as Set<CaptionsItem>} />
      ) : item.type === 'shape' ? (
        <ShapeSettings item={item} set={set as Set<ShapeItem>} track={track} />
      ) : null}
      {!isClip && item.type !== 'audio' && (
        <div className="buttons">
          <button onClick={props.onDuplicate}>Duplicar</button>
          <button className="danger" onClick={props.onDelete}>
            Eliminar
          </button>
        </div>
      )}
    </aside>
  )
}
