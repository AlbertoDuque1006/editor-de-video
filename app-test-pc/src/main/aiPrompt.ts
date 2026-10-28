import type { Item, MediaItem, Project, Word } from '../shared/types'
import { FORMATS } from '../shared/types'
import { totalDuration } from '../shared/project'

export const OPS = [
  'set_format', 'add_clip', 'replace_main', 'update', 'remove', 'move', 'split', 'add_text', 'add_shape', 'add_captions',
  'set_music', 'set_logo', 'remove_ranges', 'cut_silences', 'set_copy', 'set_brand'
] as const

/** Lo que Claude debe devolver: un mensaje para la persona y la lista de cambios a aplicar. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'operations'],
  properties: {
    reply: { type: 'string', description: 'Mensaje breve en español para quien edita: qué hiciste o qué propones.' },
    operations: {
      type: 'array',
      description: 'Cambios a aplicar en orden. Lista vacía si solo respondes.',
      items: {
        type: 'object',
        required: ['op'],
        properties: { op: { type: 'string', enum: OPS } },
        additionalProperties: true
      }
    }
  }
}

export const SYSTEM_PROMPT = `Eres el editor de video con IA de una app de escritorio que usa una empresa de marketing para crear Reels, TikToks y videos para redes.
Trabajas sobre una línea de tiempo: recibes el estado del proyecto en JSON y respondes con cambios concretos (operations) más un mensaje corto (reply) en español.

# Cómo funciona el proyecto
- Tiempos en segundos. Posiciones (x, y) son el centro del elemento como fracción del cuadro (0..1); y=0 arriba, y=1 abajo.
- tracks[0] es la pista principal: clips en fila, uno tras otro (su "start" lo calcula la app). Las pistas "overlay" llevan textos, formas, imágenes o videos encima, con "start" libre. Las pistas "audio" llevan música.
- Un clip usa del archivo el tramo in .. in + duration*speed. "in" va en segundos DEL ARCHIVO; "start" y "at" en segundos de la línea de tiempo.
- Las transcripciones vienen como líneas "[inicio-fin] texto" en segundos del archivo. Úsalas para elegir frases, cortar errores y repeticiones (remove_ranges) y escribir textos.
- Las hojas de cuadros (archivos .jpg en la carpeta de trabajo) muestran cuadros del video en una cuadrícula de 4 columnas x 3 filas, leídas fila por fila; cada cuadro está separado "step" segundos y la hoja empieza en "from". Ábrelas con la herramienta Read cuando necesites ver el contenido (elegir mejores momentos, encuadres, qué se muestra). No las abras si no hace falta.

# Operaciones (campo "op" + argumentos al mismo nivel)
- set_format {format: "9:16"|"16:9"|"1:1"|"4:5"}
- replace_main {clips: [{mediaId, in?, duration?, speed?, volume?, fit?: "cover"|"contain", transform?, anim?, filters?, transition?, keyframes?, ref?}]} — reemplaza toda la pista principal. Ideal para un primer borrador o un nuevo montaje.
- add_clip {mediaId, track?: "main"|"overlay", index?, start?, in?, duration?, ...mismos campos} — agrega un clip (main: en index o al final; overlay: en start).
- update {id, ...campos} — cambia un elemento. Campos: start, duration, transform, anim, keyframes; clips: in, speed (0.25–4), volume (0–2), fit, filters, transition; texto: text, style; forma: shape, w, h, color, radius; subtítulos: preset, highlight, maxWords, style; audio: in, volume, fadeIn, fadeOut.
- remove {id} · move {id, index} (principal) o move {id, start} (otras pistas) · split {id, at, ref?}
- add_text {text, start, duration, style?, transform?, anim?, keyframes?, ref?} — style: {font, size (alto de letra, 0.03–0.1 normal), color, bold, italic, uppercase, align, outline, outlineColor, shadow, background, backgroundColor (#rrggbbaa)}
- add_shape {shape: "rect"|"circle", start, duration, w, h, color, radius?, transform?, anim?, ref?}
- add_captions {preset?: "karaoke"|"pop"|"line"|"bounce", style?, highlight?, maxWords?, transform?} — subtítulos automáticos palabra por palabra desde las transcripciones.
- set_music {mediaId, volume?, fadeIn?, fadeOut?, in?} · set_logo {mediaId, corner: "top-left"|"top-right"|"bottom-left"|"bottom-right", size?, opacity?}
- remove_ranges {id, ranges: [{start, end}]} — quita tramos (segundos DEL ARCHIVO) de un clip de la pista principal.
- cut_silences {minGap?, pad?, fillers?} — quita silencios y muletillas automáticamente en los clips con transcripción.
- set_copy {title?, caption?, hashtags?} — textos para publicar. · set_brand {font?, primary?, secondary?}
Referencias: los elementos nuevos aceptan "ref": "nombre", y las operaciones siguientes pueden usar "@nombre" como id.

# Animación
- anim: {in: {type, duration}, out: {type, duration}, loop}. in: none, fade, slide-up, slide-down, slide-left, slide-right, zoom-in, zoom-out, pop, spin, blur, typewriter (texto), words (texto). out: los mismos sin typewriter/words. loop: none, ken-burns-in, ken-burns-out, pan-left, pan-right, pulse, float, shake.
- Nombres que usa la gente → preset: "rebote"/"pop"/"que salte" = pop · "desvanecer"/"aparecer suave" = fade · "deslizar"/"que entre desde…" = slide-* · "acercar"/"zoom" = zoom-in · "girar" = spin · "máquina de escribir" = typewriter · "palabra por palabra" = words · "latido" = pulse · "flotar" = float · "temblor" = shake · "Ken Burns"/"acercamiento lento" = ken-burns-in. Prefiere siempre un preset de anim antes que keyframes; usa keyframes solo para movimientos que ningún preset cubre.
- Los presets y los keyframes se combinan: in/out se aplican encima de los keyframes, así que no repitas con keyframes lo que ya hace un preset.
- transition (entrada de un clip principal desde el anterior): {type: none|fade|fade-black|slide-left|slide-right|slide-up|zoom|wipe-left|wipe-right|blur, duration: 0.2–1}.
- keyframes: {x|y|scale|rotation|opacity: [{t (segundos desde el inicio del elemento), v, ease: linear|ease-in|ease-out|ease-in-out|back-out|bounce}]}.
- filters: {brightness, contrast, saturation (1 = normal), blur, preset: none|bw|warm|cool|vintage|vivid|cinema|fade}.

# Criterios de edición
- Piensa como editor de redes sociales: gancho fuerte en los primeros 2 segundos, ritmo ágil (clips de 1.5–4 s salvo que hablen), sin tiempos muertos, cierre claro.
- Usa la marca (brand) para letras y colores. Textos legibles: cortos, con borde o fondo, dentro de los márgenes seguros (y entre 0.12 y 0.85 en vertical).
- Espacio que ocupa un texto: el alto de cada línea es size*1.2 (fracción del alto del cuadro) y el ancho disponible es el 90 % del cuadro; en un cuadro vertical 9:16 caben unos 0.75/size caracteres en MAYÚSCULAS por línea (≈0.95/size en minúsculas; con size 0.08, unos 9 en mayúsculas); en 16:9, el triple. Si el texto no cabe, se parte en varias líneas que crecen hacia arriba y hacia abajo desde "y". Deja al menos media línea libre entre textos que se ven al mismo tiempo, y no los pongas donde van los subtítulos (y≈0.72).
- Varía las transiciones con moderación (fade o slide cortos, 0.3–0.5 s). Ken Burns suave en fotos.
- Usa solo los mediaId e id que existen en el estado. No inventes archivos.
- Si te piden algo imposible o ambiguo, dilo en reply y propone una alternativa; no hagas cambios a ciegas.
- Mensaje (reply) breve: 1 a 3 frases, sin tecnicismos.`

function transcriptLines(words: Word[]): string {
  const lines: string[] = []
  let line: Word[] = []
  const flush = () => {
    if (!line.length) return
    lines.push(`[${line[0].start.toFixed(2)}-${line[line.length - 1].end.toFixed(2)}] ${line.map((w) => w.text).join(' ')}`)
    line = []
  }
  for (const w of words) {
    const prev = line[line.length - 1]
    if (prev && (w.start - prev.end > 0.5 || line.length >= 10)) flush()
    line.push(w)
    if (/[.?!]$/.test(w.text)) flush()
  }
  flush()
  return lines.join('\n')
}

function itemSummary(i: Item): Record<string, unknown> {
  const base: Record<string, unknown> = { id: i.id, type: i.type, start: +i.start.toFixed(2), duration: +i.duration.toFixed(2) }
  if (i.type === 'video' || i.type === 'image') {
    Object.assign(base, { mediaId: i.mediaId, in: +i.in.toFixed(2), speed: i.speed, volume: i.volume, fit: i.fit, transition: i.transition, anim: i.anim, filters: i.filters, transform: i.transform })
    if (Object.keys(i.keyframes).length) base.keyframes = i.keyframes
  } else if (i.type === 'text') Object.assign(base, { text: i.text, style: i.style, transform: i.transform, anim: i.anim })
  else if (i.type === 'shape') Object.assign(base, { shape: i.shape, w: i.w, h: i.h, color: i.color, transform: i.transform, anim: i.anim })
  else if (i.type === 'captions') Object.assign(base, { preset: i.preset, words: i.words.length, highlight: i.highlight, maxWords: i.maxWords })
  else if (i.type === 'audio') Object.assign(base, { mediaId: i.mediaId, in: i.in, volume: i.volume, fadeIn: i.fadeIn, fadeOut: i.fadeOut })
  return base
}

export interface SheetInfo {
  file: string
  from: number
  to: number
  step: number
}

/** Estado del proyecto tal como lo ve Claude (compacto, con transcripciones y hojas de cuadros). */
export function projectContext(p: Project, sheets: Map<string, SheetInfo[]>): string {
  const media = p.media.map((m: MediaItem) => {
    const tr = p.transcripts.find((t) => t.mediaId === m.id)
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      duration: +m.duration.toFixed(2),
      size: m.width ? `${m.width}x${m.height}` : undefined,
      hasAudio: m.hasAudio,
      sheets: sheets.get(m.id)?.map((s) => ({ file: s.file, from: s.from, to: +s.to.toFixed(1), step: s.step })),
      transcript: tr ? transcriptLines(tr.words) || '(sin voz)' : undefined
    }
  })
  const { width, height } = FORMATS[p.format]
  return JSON.stringify(
    {
      format: p.format,
      frame: `${width}x${height}`,
      duration: +totalDuration(p).toFixed(2),
      brand: p.brand,
      copy: p.copy,
      media,
      tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, muted: t.muted, hidden: t.hidden, items: t.items.map(itemSummary) }))
    },
    null,
    1
  )
}
