import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dividir, duplicarTramo, finAqui, inicioAqui, insertarTramo, moverTramo, quitarRango, quitarTramo, tramoEn } from '../src/lib/montaje.ts';
import { duracionTotal } from '../src/lib/proyecto.ts';
import type { Clip, Proyecto, Texto, Tramo } from '../src/lib/tipos.ts';

const clip = (id: string, duracion = 10): Clip => ({
  id, archivo: id + '.mov', nombre: id, duracion, ancho: 1080, alto: 1920, transcripcion: null, descripcion: '',
});
const tramo = (id: string, inicio: number, fin: number): Tramo => ({ id, clipId: id, inicio, fin });
const texto = (id: string, inicio: number, fin: number): Texto => ({
  id, texto: id, inicio, fin, posicion: 'centro', estilo: 'titulo', animacion: 'aparecer', color: '#FFFFFF',
});
const proyecto = (tramos: Tramo[], textos: Texto[] = []): Proyecto => ({
  id: 'p', nombre: 'Prueba', creado: 0, editado: 0, formato: '9:16', pedido: '', duracionDeseada: null,
  clips: tramos.map((t) => clip(t.clipId)), tramos, textos, subtitulos: false, musica: null,
  volumenOriginal: 1, publicacion: null, chat: [],
});
const red = (n: number) => Math.round(n * 1000) / 1000;
const tiempos = (p: Proyecto) => p.tramos.map((t) => [t.id, red(t.inicio), red(t.fin)]);
const textos = (p: Proyecto) => p.textos.map((t) => [t.id, red(t.inicio), red(t.fin)]);

test('dividir crea dos ids, conserva textos y rechaza bordes', () => {
  const p = proyecto([tramo('a', 2, 5)], [texto('x', 0, 3)]);
  const r = dividir(p, 1.5)!;
  assert.deepEqual(r.tramos.map((t) => [red(t.inicio), red(t.fin)]), [[2, 3.5], [3.5, 5]]);
  assert.ok(r.tramos.every((t) => t.id !== 'a'));
  assert.notEqual(r.tramos[0].id, r.tramos[1].id);
  assert.deepEqual(textos(r), [['x', 0, 3]]);
  assert.deepEqual(tiempos(p), [['a', 2, 5]]);
  assert.equal(dividir(p, 0.2), null);
  assert.equal(dividir(p, 2.8), null);
  assert.equal(tramoEn(p, 3), -1);
  assert.equal(tramoEn(proyecto([]), 0), -1);
});

test('quitarRango cruza tramos y comprime y recorta textos', () => {
  const p = proyecto([tramo('a', 0, 2), tramo('b', 0, 2)], [
    texto('antes', 0, 1), texto('cruza', 1, 3), texto('dentro', 1.6, 2.4), texto('despues', 3, 4),
  ]);
  const r = quitarRango(p, 1.5, 2.5)!;
  assert.deepEqual(tiempos(r), [['a', 0, 1.5], ['b', 0.5, 2]]);
  assert.deepEqual(textos(r), [['antes', 0, 1], ['cruza', 1, 2], ['despues', 2, 3]]);
  assert.equal(red(duracionTotal(r)), 3);
  assert.deepEqual(textos(p)[3], ['despues', 3, 4]);
});

test('quitarRango elimina tramo entero y restos cortos; textos siguen la eliminación ampliada', () => {
  const p = proyecto([tramo('a', 0, 1), tramo('b', 0, 1), tramo('c', 0, 1)], [texto('x', 2, 3)]);
  const r = quitarRango(p, 1, 2)!;
  assert.deepEqual(tiempos(r), [['a', 0, 1], ['c', 0, 1]]);
  assert.deepEqual(textos(r), [['x', 1, 2]]);

  const corto = proyecto([tramo('a', 0, 1), tramo('b', 0, 1)], [texto('x', 0.8, 2)]);
  const s = quitarRango(corto, 0.2, 0.9)!;
  assert.deepEqual(tiempos(s), [['b', 0, 1]]);
  assert.deepEqual(textos(s), [['x', 0, 1]]);
  assert.equal(quitarRango(proyecto([tramo('a', 0, 1)]), 0, 1), null);
  assert.equal(quitarRango(p, 0, 0.04), null);
});

test('inicioAqui y finAqui recortan solo el tramo indicado', () => {
  const p = proyecto([tramo('a', 0, 2), tramo('b', 0, 2)], [texto('x', 2, 4)]);
  assert.deepEqual(tiempos(inicioAqui(p, 1, 2.5)!), [['a', 0, 2], ['b', 0.5, 2]]);
  assert.deepEqual(textos(inicioAqui(p, 1, 2.5)!), [['x', 2, 3.5]]);
  assert.deepEqual(tiempos(finAqui(p, 0, 1.5)!), [['a', 0, 1.5], ['b', 0, 2]]);
  assert.equal(inicioAqui(p, 1, 3.8), null);
  assert.equal(finAqui(p, 0, 0.2), null);
  assert.equal(inicioAqui(p, 1, 1), null);
});

test('quitarTramo, duplicarTramo e insertarTramo ajustan textos', () => {
  const p = proyecto([tramo('a', 0, 1), tramo('b', 0, 2)], [texto('x', 1, 3)]);
  assert.equal(quitarTramo(proyecto([tramo('a', 0, 1)]), 0), null);
  assert.deepEqual(textos(quitarTramo(p, 0)!), [['x', 0, 2]]);
  const duplicado = duplicarTramo(p, 0);
  assert.deepEqual(duplicado.tramos.map((t) => t.clipId), ['a', 'a', 'b']);
  assert.notEqual(duplicado.tramos[1].id, 'a');
  assert.deepEqual(textos(duplicado), [['x', 2, 4]]);
  const insertado = insertarTramo(p, 1, tramo('c', 0, 0.5));
  assert.deepEqual(insertado.tramos.map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(textos(insertado), [['x', 1.5, 3.5]]);
});

test('moverTramo respeta bordes y no cambia textos', () => {
  const p = proyecto([tramo('a', 0, 1), tramo('b', 0, 2)], [texto('x', 0, 3)]);
  assert.equal(moverTramo(p, 0, -1), null);
  assert.equal(moverTramo(p, 1, 1), null);
  const r = moverTramo(p, 0, 1)!;
  assert.deepEqual(r.tramos.map((t) => t.id), ['b', 'a']);
  assert.deepEqual(textos(r), [['x', 0, 3]]);
  assert.deepEqual(p.tramos.map((t) => t.id), ['a', 'b']);
});

test('todas las operaciones recortan textos que exceden la duración final', () => {
  const p = proyecto([tramo('a', 0, 1), tramo('b', 0, 1)], [texto('largo', 0, 5), texto('corto', 1.8, 5)]);
  const r = quitarTramo(p, 1)!;
  assert.deepEqual(textos(r), [['largo', 0, 1]]);
  assert.deepEqual(textos(p), [['largo', 0, 5], ['corto', 1.8, 5]]);
});
