import type { Animacion, Estilo, Posicion } from './tipos.ts';

/**
 * Medidas de textos y subtítulos como fracción del ancho (W) o alto (H) del video.
 * Son las mismas que usa el exportador en Swift (modules/editor-nativo/ios/Exportador.swift):
 * si cambias una, cambia la otra, o la vista previa no se parecerá al video exportado.
 */
export const ANCHO_TEXTO = 0.84;

export const CENTRO_Y: Record<Posicion, number> = { arriba: 0.16, centro: 0.45, abajo: 0.66 };
export const CENTRO_Y_SUBTITULOS = 0.76;

export const TAMANO: Record<Estilo, number> = { titulo: 0.085, subtitulo: 0.058, etiqueta: 0.048 };
export const PESO: Record<Estilo, '900' | '600' | '700'> = { titulo: '900', subtitulo: '600', etiqueta: '700' };
export const TAMANO_SUBTITULOS = 0.055;

export const ENTRADA = 0.35;
export const SALIDA = 0.25;

/** Cómo se ve un texto en el segundo `t`: opacidad, desplazamiento (en fracción de H) y escala. */
export function animacionEn(
  animacion: Animacion,
  inicio: number,
  fin: number,
  t: number,
): { opacidad: number; dy: number; escala: number } {
  if (t < inicio || t >= fin) return { opacidad: 0, dy: 0, escala: 1 };
  // Lineal entre puntos, igual que los fotogramas clave de Core Animation en Exportador.swift.
  const e = Math.min(1, (t - inicio) / ENTRADA);
  const s = Math.min(1, (fin - t) / SALIDA);
  const opacidad = Math.min(e, s);
  let dy = 0;
  let escala = 1;
  if (animacion === 'subir') dy = 0.04 * (1 - e);
  if (animacion === 'zoom') escala = 0.6 + 0.4 * e;
  if (animacion === 'rebote') escala = e < 0.7 ? 0.3 + (1.12 - 0.3) * (e / 0.7) : 1.12 - 0.12 * ((e - 0.7) / 0.3);
  return { opacidad, dy, escala };
}

export const COLORES = ['#FFFFFF', '#FFD60A', '#FF375F', '#30D158', '#0A84FF', '#BF5AF2', '#000000'];

