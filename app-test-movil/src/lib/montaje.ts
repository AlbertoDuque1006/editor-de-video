import type { Proyecto, Texto, Tramo } from './tipos.ts';
import { duracionTotal, iniciosDeTramos, nuevoId, TRAMO_MINIMO, ubicar } from './proyecto.ts';

const EPS = 1e-9;

function limitarTextos(textos: Texto[], total: number): Texto[] {
  return textos.map((texto) => ({ ...texto, fin: Math.min(texto.fin, total) }))
    .filter((texto) => texto.fin - texto.inicio + EPS >= TRAMO_MINIMO);
}

function resultado(p: Proyecto, tramos: Tramo[], textos: Texto[]): Proyecto {
  return { ...p, tramos, textos: limitarTextos(textos, duracionTotal({ tramos })) };
}

/** Índice del tramo que suena en t. */
export function tramoEn(p: Proyecto, t: number): number {
  if (!Number.isFinite(t) || t < 0 || t >= duracionTotal(p)) return -1;
  return ubicar(p.tramos, t)?.indice ?? -1;
}

/** Parte un tramo sin cambiar la duración del video ni los textos. */
export function dividir(p: Proyecto, t: number): Proyecto | null {
  const i = tramoEn(p, t);
  if (i < 0) return null;
  const tramo = p.tramos[i];
  const corte = ubicar(p.tramos, t)!.tiempoClip;
  if (corte - tramo.inicio + EPS < TRAMO_MINIMO || tramo.fin - corte + EPS < TRAMO_MINIMO) return null;
  const tramos = [...p.tramos];
  tramos.splice(i, 1, { ...tramo, id: nuevoId(), fin: corte }, { ...tramo, id: nuevoId(), inicio: corte });
  return resultado(p, tramos, p.textos);
}

/** Borra un intervalo y los restos de tramo que queden demasiado cortos. */
export function quitarRango(p: Proyecto, desde: number, hasta: number): Proyecto | null {
  const total = duracionTotal(p);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return null;
  const a = Math.max(0, Math.min(total, desde));
  const b = Math.max(0, Math.min(total, hasta));
  if (b - a < 0.05) return null;

  const inicios = iniciosDeTramos(p.tramos);
  const tramos: Tramo[] = [];
  const conservados: { inicio: number; fin: number }[] = [];
  p.tramos.forEach((tramo, i) => {
    const inicio = inicios[i];
    const fin = inicio + tramo.fin - tramo.inicio;
    const partes = [
      { inicio, fin: Math.min(fin, a) },
      { inicio: Math.max(inicio, b), fin },
    ].filter((parte) => parte.fin - parte.inicio + EPS >= TRAMO_MINIMO);
    // Un tramo fuera del rango aparece en una sola de las dos partes.
    partes.forEach((parte) => {
      conservados.push(parte);
      tramos.push({
        ...tramo,
        id: partes.length === 2 ? nuevoId() : tramo.id,
        inicio: tramo.inicio + parte.inicio - inicio,
        fin: tramo.inicio + parte.fin - inicio,
      });
    });
  });
  if (tramos.length === 0) return null;

  // Cada hueco entre partes conservadas (incluidos los restos cortos) se
  // comprime para que los textos mantengan su posición respecto al video.
  const trasladar = (t: number): number => {
    let nuevo = 0;
    for (const parte of conservados) {
      if (t <= parte.inicio) return nuevo;
      nuevo += Math.max(0, Math.min(t, parte.fin) - parte.inicio);
      if (t <= parte.fin) return nuevo;
    }
    return nuevo;
  };
  const textos = p.textos.map((texto) => ({ ...texto, inicio: trasladar(texto.inicio), fin: trasladar(texto.fin) }));
  return resultado(p, tramos, textos);
}

/** Recorta el principio del tramo i hasta t. */
export function inicioAqui(p: Proyecto, i: number, t: number): Proyecto | null {
  if (!Number.isInteger(i) || i < 0 || i >= p.tramos.length || !Number.isFinite(t)) return null;
  const inicio = iniciosDeTramos(p.tramos)[i];
  const fin = inicio + p.tramos[i].fin - p.tramos[i].inicio;
  if (t <= inicio || t >= fin || fin - t + EPS < TRAMO_MINIMO) return null;
  return quitarRango(p, inicio, t);
}

/** Recorta el final del tramo i desde t. */
export function finAqui(p: Proyecto, i: number, t: number): Proyecto | null {
  if (!Number.isInteger(i) || i < 0 || i >= p.tramos.length || !Number.isFinite(t)) return null;
  const inicio = iniciosDeTramos(p.tramos)[i];
  const fin = inicio + p.tramos[i].fin - p.tramos[i].inicio;
  if (t <= inicio || t >= fin || t - inicio + EPS < TRAMO_MINIMO) return null;
  return quitarRango(p, t, fin);
}

/** Borra un tramo completo. */
export function quitarTramo(p: Proyecto, i: number): Proyecto | null {
  if (!Number.isInteger(i) || i < 0 || i >= p.tramos.length || p.tramos.length === 1) return null;
  const inicio = iniciosDeTramos(p.tramos)[i];
  return quitarRango(p, inicio, inicio + p.tramos[i].fin - p.tramos[i].inicio);
}

/** Inserta un tramo y desplaza los textos que comienzan desde ese punto. */
export function insertarTramo(p: Proyecto, i: number, tramo: Tramo): Proyecto {
  const posicion = Math.max(0, Math.min(p.tramos.length, Math.trunc(i)));
  const punto = posicion === p.tramos.length ? duracionTotal(p) : iniciosDeTramos(p.tramos)[posicion];
  const largo = tramo.fin - tramo.inicio;
  const tramos = [...p.tramos];
  tramos.splice(posicion, 0, { ...tramo });
  const textos = p.textos.map((texto) => texto.inicio >= punto
    ? { ...texto, inicio: texto.inicio + largo, fin: texto.fin + largo }
    : { ...texto });
  return resultado(p, tramos, textos);
}

/** Duplica el tramo i inmediatamente después de él. */
export function duplicarTramo(p: Proyecto, i: number): Proyecto {
  if (!Number.isInteger(i) || i < 0 || i >= p.tramos.length) return resultado(p, [...p.tramos], p.textos);
  return insertarTramo(p, i + 1, { ...p.tramos[i], id: nuevoId() });
}

/** Mueve un tramo una posición sin alterar el tiempo de los textos. */
export function moverTramo(p: Proyecto, i: number, d: -1 | 1): Proyecto | null {
  if (!Number.isInteger(i) || i < 0 || i >= p.tramos.length || i + d < 0 || i + d >= p.tramos.length) return null;
  const tramos = [...p.tramos];
  [tramos[i], tramos[i + d]] = [tramos[i + d], tramos[i]];
  return resultado(p, tramos, p.textos);
}
