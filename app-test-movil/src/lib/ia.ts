import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { leerClave } from './ajustes';
import { FORMATOS, duracionTotal, subtitulosDe, type Plan } from './proyecto';
import { uriDe } from './almacen';
import { miniaturas } from './medios';
import type { Palabra, Proyecto } from './tipos';

const MODELO = 'claude-opus-5-5';

const PlanSchema = z.object({
  mensaje: z.string().describe('Mensaje breve en español para quien edita: qué hiciste, 1 a 3 frases, sin tecnicismos.'),
  tramos: z
    .array(
      z.object({
        clip: z.number().int().describe('Número del clip, empezando en 1.'),
        inicio: z.number().describe('Segundo del clip donde empieza el pedazo.'),
        fin: z.number().describe('Segundo del clip donde termina el pedazo.'),
      }),
    )
    .describe('Pedazos de los clips en el orden del video final.'),
  textos: z.array(
    z.object({
      texto: z.string(),
      inicio: z.number().describe('Segundo del video final.'),
      fin: z.number().describe('Segundo del video final.'),
      // Texto libre y no enum: un valor raro se corrige en aplicarPlan en vez de tumbar todo el plan.
      posicion: z.string().describe('Una de: arriba, centro, abajo.'),
      estilo: z.string().describe('Una de: titulo, subtitulo, etiqueta.'),
      animacion: z.string().describe('Una de: aparecer, subir, zoom, rebote.'),
      color: z.string().describe('Color #RRGGBB.'),
    }),
  ),
  subtitulos: z.boolean().describe('Mostrar subtítulos automáticos con lo que se dice.'),
  publicacion: z.object({
    titulo: z.string(),
    descripcion: z.string().describe('Texto para acompañar la publicación en redes.'),
    hashtags: z.array(z.string()),
  }),
  descripcionesClips: z
    .array(z.string())
    .describe('Una descripción corta de lo que se ve en cada clip, en el mismo orden de los clips.'),
});

const SISTEMA = `Eres el editor de video con IA de una app de iPhone que usa una empresa de marketing para crear Reels, TikToks y videos para redes.
Recibes los clips del proyecto (con fotos de cada uno, lo que se dice en ellos y su duración) y el estado actual del montaje. Respondes con el montaje completo actualizado: siempre devuelves TODOS los tramos y TODOS los textos que deben quedar, no solo los cambios.

# Cómo funciona el montaje
- El video final es la fila de "tramos": pedazos de los clips, uno tras otro. "inicio" y "fin" del tramo van en segundos DEL CLIP.
- Los textos van encima del video; su "inicio" y "fin" van en segundos DEL VIDEO FINAL.
- Las transcripciones vienen como líneas "[inicio-fin] texto" en segundos del clip. Úsalas para quedarte con las mejores frases, cortar errores, repeticiones, silencios y muletillas, y para escribir los textos.
- Estilos de texto: "titulo" (grande, para el gancho), "subtitulo" (mediano), "etiqueta" (pequeño en una caja de color, para datos, precios o llamados a la acción). Posiciones: arriba, centro, abajo. Los subtítulos automáticos van un poco más abajo que "abajo".
- Animaciones de entrada: aparecer, subir, zoom, rebote.

# Criterios de edición
- Piensa como editor de redes sociales: gancho fuerte en los primeros 2 segundos, ritmo ágil (tramos de 1.5 a 4 s salvo que alguien esté hablando), sin tiempos muertos, cierre claro con llamado a la acción si aplica.
- Si alguien habla, no cortes en mitad de una frase: corta en los bordes de las líneas de la transcripción.
- Textos cortos y legibles: un título de 2 a 6 palabras; nunca más de 2 textos a la vez, y si están a la vez, en posiciones distintas. En vertical caben unos 12 caracteres en MAYÚSCULAS por línea en "titulo" y unos 20 en "subtitulo".
- Si hay subtítulos, no pongas textos en "abajo" mientras alguien habla.
- Respeta la duración pedida si hay una (±15 %).
- Colores: blanco o amarillo para títulos sobre video; etiquetas en un color vivo.
- Si te piden algo imposible o ambiguo, dilo en "mensaje", propón una alternativa y devuelve el montaje sin cambios.
- La publicación: título con gancho, descripción de 1 a 3 frases con emojis moderados y 5 a 10 hashtags en español relevantes.`;

function lineasTranscripcion(palabras: Palabra[]): string {
  const lineas: string[] = [];
  let linea: Palabra[] = [];
  const cerrar = () => {
    if (!linea.length) return;
    lineas.push(`[${linea[0].inicio.toFixed(1)}-${linea[linea.length - 1].fin.toFixed(1)}] ${linea.map((w) => w.texto).join(' ')}`);
    linea = [];
  };
  for (const w of palabras) {
    if (linea.length && w.inicio - linea[linea.length - 1].fin > 0.5) cerrar();
    linea.push(w);
    if (/[.!?…]$/.test(w.texto) || linea.length >= 12) cerrar();
  }
  cerrar();
  return lineas.join('\n');
}

function estadoMontaje(p: Proyecto): string {
  const indice = new Map(p.clips.map((c, i) => [c.id, i + 1]));
  return JSON.stringify({
    duracionTotal: Number(duracionTotal(p).toFixed(1)),
    tramos: p.tramos.map((t) => ({ clip: indice.get(t.clipId), inicio: +t.inicio.toFixed(2), fin: +t.fin.toFixed(2) })),
    textos: p.textos.map(({ id: _id, ...t }) => ({ ...t, inicio: +t.inicio.toFixed(2), fin: +t.fin.toFixed(2) })),
    subtitulos: p.subtitulos,
    lineasDeSubtitulos: p.subtitulos ? subtitulosDe(p).length : 0,
    publicacion: p.publicacion,
  });
}

type Bloque = Anthropic.Beta.BetaContentBlockParam;

async function describirClips(p: Proyecto, conFotos: boolean): Promise<Bloque[]> {
  const bloques: Bloque[] = [];
  // Con muchos clips se mandan menos fotos por clip para no pasarse de tamaño.
  const fotosPorClip = p.clips.length <= 4 ? 4 : p.clips.length <= 10 ? 2 : 1;
  for (const [i, c] of p.clips.entries()) {
    const partes = [`Clip ${i + 1}: "${c.nombre}", ${c.duracion.toFixed(1)} s, ${c.ancho}×${c.alto}.`];
    if (c.descripcion) partes.push(`Se ve: ${c.descripcion}`);
    if (c.transcripcion === null) partes.push('Sin transcripción.');
    else if (c.transcripcion.length === 0) partes.push('No se habla en este clip.');
    else partes.push('Lo que se dice:\n' + lineasTranscripcion(c.transcripcion));
    bloques.push({ type: 'text', text: partes.join('\n') });
    if (conFotos) {
      const fotos = await miniaturas(uriDe(p.id, c.archivo), c.duracion, fotosPorClip).catch(() => []);
      for (const data of fotos) bloques.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
    }
  }
  return bloques;
}

export class ErrorIA extends Error {}

async function pedirPlan(p: Proyecto, pedido: string, conFotos: boolean, esfuerzo: 'low' | 'medium'): Promise<Plan> {
  const apiKey = await leerClave();
  if (!apiKey) throw new ErrorIA('Falta la clave de Claude. Ponla en Ajustes.');
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });

  const formato = FORMATOS[p.formato];
  const historial = p.chat
    .slice(-8)
    .map((m) => `${m.de === 'yo' ? 'Persona' : 'Tú'}: ${m.texto}`)
    .join('\n');

  const contenido: Bloque[] = [
    ...(await describirClips(p, conFotos)),
    {
      type: 'text',
      text: [
        `Formato: ${p.formato} (${formato.nombre}, ${formato.uso}).`,
        p.duracionDeseada ? `Duración pedida: ${p.duracionDeseada} s.` : 'Duración: libre.',
        `Lo que la persona quiere del video: ${p.pedido || '(no lo dijo)'}`,
        `Montaje actual: ${estadoMontaje(p)}`,
        historial ? `Conversación reciente:\n${historial}` : '',
        `Pedido ahora: ${pedido}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  try {
    const r = await client.beta.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: esfuerzo, format: betaZodOutputFormat(PlanSchema) },
      system: SISTEMA,
      messages: [{ role: 'user', content: contenido }],
    });
    if (r.stop_reason === 'refusal') throw new ErrorIA('Claude no quiso hacer este pedido. Prueba a decirlo de otra forma.');
    if (r.stop_reason === 'max_tokens') throw new ErrorIA('La respuesta salió demasiado larga. Pide algo más concreto.');
    if (!r.parsed_output) throw new ErrorIA('Claude respondió en un formato inesperado. Intenta de nuevo.');
    return r.parsed_output;
  } catch (e) {
    if (e instanceof ErrorIA) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ErrorIA('La clave de Claude no es válida. Revísala en Ajustes.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new ErrorIA('La clave de Claude no tiene permiso para este modelo.');
    if (e instanceof Anthropic.RateLimitError) throw new ErrorIA('Claude está recibiendo muchos pedidos. Espera un momento y repite.');
    if (e instanceof Anthropic.APIConnectionError) throw new ErrorIA('Sin conexión con Claude. Revisa el internet.');
    if (e instanceof Anthropic.APIError) throw new ErrorIA(`Claude devolvió un error (${e.status ?? '?'}): ${e.message}`);
    if (e instanceof Error && e.message.startsWith('Failed to parse structured output')) {
      throw new ErrorIA('Claude respondió en un formato inesperado. Intenta de nuevo.');
    }
    throw e;
  }
}

/** Primer borrador: Claude mira las fotos de cada clip y arma el video. */
export function crearBorrador(p: Proyecto): Promise<Plan> {
  return pedirPlan(p, 'Arma el primer borrador del video a partir de los clips.', true, 'medium');
}

/** Un cambio pedido en el chat. No vuelve a mandar fotos: usa las descripciones de los clips. */
export function pedirCambio(p: Proyecto, pedido: string): Promise<Plan> {
  return pedirPlan(p, pedido, false, 'low');
}

/** Comprueba la clave con una llamada mínima. */
export async function probarClave(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
  await client.models.retrieve(MODELO);
}
