import type { Animacion, Clip, Estilo, Formato, Posicion, Proyecto, Subtitulo, Texto, Tramo } from './tipos.ts';

/** Código puro: sin React ni Expo, para poder probarlo con node --test. */

export const TRAMO_MINIMO = 0.3;
export const COLOR_POR_DEFECTO = '#FFFFFF';

export const FORMATOS: Record<Formato, { ancho: number; alto: number; nombre: string; uso: string }> = {
  '9:16': { ancho: 1080, alto: 1920, nombre: 'Vertical', uso: 'Reels, TikTok, Historias' },
  '1:1': { ancho: 1080, alto: 1080, nombre: 'Cuadrado', uso: 'Publicación de Instagram' },
  '16:9': { ancho: 1920, alto: 1080, nombre: 'Horizontal', uso: 'YouTube' },
};

export function nuevoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function duracionTotal(p: Pick<Proyecto, 'tramos'>): number {
  return p.tramos.reduce((s, t) => s + (t.fin - t.inicio), 0);
}

/** Dónde empieza cada tramo en el video final. */
export function iniciosDeTramos(tramos: Tramo[]): number[] {
  const inicios: number[] = [];
  let acumulado = 0;
  for (const t of tramos) {
    inicios.push(acumulado);
    acumulado += t.fin - t.inicio;
  }
  return inicios;
}

/** Qué tramo suena en el segundo `t` del video final y en qué segundo de su clip va. */
export function ubicar(tramos: Tramo[], t: number): { indice: number; tiempoClip: number } | null {
  if (tramos.length === 0) return null;
  let acumulado = 0;
  for (let i = 0; i < tramos.length; i++) {
    const largo = tramos[i].fin - tramos[i].inicio;
    if (t < acumulado + largo || i === tramos.length - 1) {
      const dentro = limitar(t - acumulado, 0, largo);
      return { indice: i, tiempoClip: tramos[i].inicio + dentro };
    }
    acumulado += largo;
  }
  return null;
}

/** El primer tramo de cada clip, en orden, para empezar un proyecto sin IA. */
export function tramosCompletos(clips: Clip[]): Tramo[] {
  return clips.map((c) => ({ id: nuevoId(), clipId: c.id, inicio: 0, fin: c.duracion }));
}

const FIN_DE_FRASE = /[.!?…]$/;
const MAX_PALABRAS = 5;
const MAX_LETRAS = 26;
const PAUSA = 0.6;

/**
 * Arma las líneas de subtítulos del video final con las palabras transcritas de cada tramo.
 * Corta la línea por largo, por pausa o al final de una frase.
 */
export function subtitulosDe(p: Pick<Proyecto, 'tramos' | 'clips'>): Subtitulo[] {
  const clips = new Map(p.clips.map((c) => [c.id, c]));
  const inicios = iniciosDeTramos(p.tramos);
  const lineas: Subtitulo[] = [];

  p.tramos.forEach((tramo, i) => {
    const palabras = clips.get(tramo.clipId)?.transcripcion ?? [];
    let actual: Subtitulo | null = null;
    let cuenta = 0;
    const cerrar = () => {
      if (actual) lineas.push(actual);
      actual = null;
      cuenta = 0;
    };
    for (const w of palabras) {
      const centro = (w.inicio + w.fin) / 2;
      if (centro < tramo.inicio || centro >= tramo.fin) continue;
      const inicio = inicios[i] + Math.max(0, w.inicio - tramo.inicio);
      const fin = inicios[i] + Math.min(tramo.fin, w.fin) - tramo.inicio;
      const texto = w.texto.trim();
      if (!texto) continue;
      if (actual) {
        const linea: Subtitulo = actual;
        const largo = linea.texto.length + 1 + texto.length;
        if (cuenta >= MAX_PALABRAS || largo > MAX_LETRAS || inicio - linea.fin > PAUSA) cerrar();
      }
      if (actual) {
        const linea: Subtitulo = actual;
        linea.texto += ' ' + texto;
        linea.fin = fin;
      } else {
        actual = { texto, inicio, fin };
      }
      cuenta++;
      if (FIN_DE_FRASE.test(texto)) cerrar();
    }
    cerrar();
  });

  // Que una línea dure hasta la siguiente si el hueco es corto, para que no parpadee.
  for (let i = 0; i < lineas.length - 1; i++) {
    const hueco = lineas[i + 1].inicio - lineas[i].fin;
    if (hueco > 0 && hueco < 0.35) lineas[i].fin = lineas[i + 1].inicio;
  }
  return lineas;
}

export interface TramoPlan {
  clip: number;
  inicio: number;
  fin: number;
}

export interface TextoPlan {
  texto: string;
  inicio: number;
  fin: number;
  posicion: string;
  estilo: string;
  animacion: string;
  color: string;
}

/** Lo que devuelve la IA. `clip` es el número del clip empezando en 1. */
export interface Plan {
  mensaje: string;
  tramos: TramoPlan[];
  textos: TextoPlan[];
  subtitulos: boolean;
  publicacion: { titulo: string; descripcion: string; hashtags: string[] };
  descripcionesClips: string[];
}

/**
 * Aplica el plan de la IA al proyecto, corrigiendo lo que venga fuera de rango:
 * tramos fuera del clip, textos fuera del video, colores inválidos.
 */
export function aplicarPlan(p: Proyecto, plan: Plan): Proyecto {
  const tramos: Tramo[] = [];
  for (const t of plan.tramos) {
    const clip = p.clips[Math.round(t.clip) - 1];
    if (!clip) continue;
    const inicio = limitar(t.inicio, 0, clip.duracion);
    const fin = limitar(t.fin, 0, clip.duracion);
    if (fin - inicio < TRAMO_MINIMO) continue;
    tramos.push({ id: nuevoId(), clipId: clip.id, inicio, fin });
  }
  // Si la IA no dejó nada usable, se conserva lo que había.
  const tramosFinales = tramos.length > 0 ? tramos : p.tramos;
  const total = duracionTotal({ tramos: tramosFinales });

  const textos: Texto[] = [];
  for (const t of plan.textos) {
    const texto = t.texto.trim();
    if (!texto) continue;
    const inicio = limitar(t.inicio, 0, total);
    const fin = limitar(t.fin, 0, total);
    if (fin - inicio < TRAMO_MINIMO) continue;
    textos.push({
      id: nuevoId(),
      texto,
      inicio,
      fin,
      posicion: unoDe(t.posicion, POSICIONES, 'centro'),
      estilo: unoDe(t.estilo, ESTILOS, 'titulo'),
      animacion: unoDe(t.animacion, ANIMACIONES, 'aparecer'),
      color: colorValido(t.color),
    });
  }

  const hashtags = plan.publicacion.hashtags
    .map((h) => h.trim().replace(/^#*/, '#').replace(/\s+/g, ''))
    .filter((h) => h.length > 1);

  return {
    ...p,
    tramos: tramosFinales,
    textos,
    subtitulos: plan.subtitulos,
    publicacion: { titulo: plan.publicacion.titulo.trim(), descripcion: plan.publicacion.descripcion.trim(), hashtags },
    clips: p.clips.map((c, i) => ({ ...c, descripcion: plan.descripcionesClips[i]?.trim() || c.descripcion })),
    editado: Date.now(),
  };
}

const POSICIONES: readonly Posicion[] = ['arriba', 'centro', 'abajo'];
const ESTILOS: readonly Estilo[] = ['titulo', 'subtitulo', 'etiqueta'];
const ANIMACIONES: readonly Animacion[] = ['aparecer', 'subir', 'zoom', 'rebote'];

/** El valor si es una de las opciones (sin importar mayúsculas ni tildes); si no, el de por defecto. */
function unoDe<T extends string>(valor: string, opciones: readonly T[], porDefecto: T): T {
  const v = valor.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return opciones.find((o) => o === v) ?? porDefecto;
}

export function colorValido(color: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return ('#' + [...c.slice(1)].map((x) => x + x).join('')).toUpperCase();
  return COLOR_POR_DEFECTO;
}

/** Luminancia de 0 a 1, para decidir si las letras de una etiqueta van negras o blancas. */
export function luminancia(color: string): number {
  const c = colorValido(color);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Los textos que se ven en el segundo `t`. */
export function textosEn(textos: Texto[], t: number): Texto[] {
  return textos.filter((x) => t >= x.inicio && t < x.fin);
}

export function formatoTiempo(seg: number): string {
  const s = Math.max(0, seg);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
