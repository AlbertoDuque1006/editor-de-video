import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarPlan,
  colorValido,
  duracionTotal,
  luminancia,
  subtitulosDe,
  ubicar,
  type Plan,
} from '../src/lib/proyecto.ts';
import { animacionEn } from '../src/lib/estilos.ts';
import type { Clip, Proyecto } from '../src/lib/tipos.ts';

const clip = (id: string, duracion: number, transcripcion: Clip['transcripcion'] = null): Clip => ({
  id,
  archivo: id + '.mov',
  nombre: id,
  duracion,
  ancho: 1080,
  alto: 1920,
  transcripcion,
  descripcion: '',
});

const proyecto = (clips: Clip[]): Proyecto => ({
  id: 'p',
  nombre: 'Prueba',
  creado: 0,
  editado: 0,
  formato: '9:16',
  pedido: '',
  duracionDeseada: null,
  clips,
  tramos: [],
  textos: [],
  subtitulos: false,
  musica: null,
  volumenOriginal: 1,
  publicacion: null,
  chat: [],
});

const plan = (parcial: Partial<Plan>): Plan => ({
  mensaje: '',
  tramos: [],
  textos: [],
  subtitulos: true,
  publicacion: { titulo: 'T', descripcion: 'D', hashtags: [] },
  descripcionesClips: [],
  ...parcial,
});

test('ubicar encuentra el tramo y el segundo dentro del clip', () => {
  const tramos = [
    { id: 'a', clipId: 'x', inicio: 2, fin: 5 },
    { id: 'b', clipId: 'y', inicio: 10, fin: 12 },
  ];
  assert.deepEqual(ubicar(tramos, 0), { indice: 0, tiempoClip: 2 });
  assert.deepEqual(ubicar(tramos, 3.5), { indice: 1, tiempoClip: 10.5 });
  assert.deepEqual(ubicar(tramos, 99), { indice: 1, tiempoClip: 12 });
  assert.equal(ubicar([], 1), null);
});

test('aplicarPlan corrige tramos y textos fuera de rango', () => {
  const p = proyecto([clip('x', 10), clip('y', 4)]);
  const r = aplicarPlan(
    p,
    plan({
      tramos: [
        { clip: 1, inicio: -1, fin: 3 },
        { clip: 2, inicio: 3, fin: 9 },
        { clip: 7, inicio: 0, fin: 2 },
        { clip: 1, inicio: 5, fin: 5.1 },
      ],
      textos: [
        { texto: ' Hola ', inicio: 0, fin: 50, posicion: 'arriba', estilo: 'titulo', animacion: 'zoom', color: 'rojo' },
        { texto: '   ', inicio: 0, fin: 1, posicion: 'centro', estilo: 'titulo', animacion: 'zoom', color: '#fff' },
        { texto: 'Raro', inicio: 1, fin: 2, posicion: 'Centrado', estilo: 'Título', animacion: 'girar', color: '#fff' },
      ],
      publicacion: { titulo: ' Mi video ', descripcion: 'x', hashtags: ['marketing', '#Cali', 'dos palabras', '#'] },
      descripcionesClips: ['Persona hablando'],
    }),
  );
  assert.deepEqual(
    r.tramos.map((t) => [t.clipId, t.inicio, t.fin]),
    [
      ['x', 0, 3],
      ['y', 3, 4],
    ],
  );
  assert.equal(duracionTotal(r), 4);
  assert.equal(r.textos.length, 2);
  assert.equal(r.textos[0].texto, 'Hola');
  assert.deepEqual([r.textos[1].posicion, r.textos[1].estilo, r.textos[1].animacion], ['centro', 'titulo', 'aparecer']);
  assert.equal(r.textos[0].fin, 4);
  assert.equal(r.textos[0].color, '#FFFFFF');
  assert.deepEqual(r.publicacion?.hashtags, ['#marketing', '#Cali', '#dospalabras']);
  assert.equal(r.publicacion?.titulo, 'Mi video');
  assert.equal(r.clips[0].descripcion, 'Persona hablando');
});

test('aplicarPlan conserva los tramos si la IA no deja ninguno válido', () => {
  const p = { ...proyecto([clip('x', 10)]), tramos: [{ id: 't', clipId: 'x', inicio: 0, fin: 10 }] };
  const r = aplicarPlan(p, plan({ tramos: [{ clip: 3, inicio: 0, fin: 1 }] }));
  assert.equal(r.tramos, p.tramos);
});

test('subtítulos siguen los cortes y se parten por frase y pausa', () => {
  const palabras = [
    { texto: 'Hola', inicio: 0.0, fin: 0.3 },
    { texto: 'a', inicio: 0.35, fin: 0.4 },
    { texto: 'todos.', inicio: 0.45, fin: 0.8 },
    { texto: 'Hoy', inicio: 2.0, fin: 2.2 },
    { texto: 'les', inicio: 2.25, fin: 2.4 },
    { texto: 'cuento', inicio: 2.45, fin: 2.8 },
    { texto: 'algo', inicio: 4.0, fin: 4.3 },
  ];
  const p = proyecto([clip('x', 6, palabras)]);
  p.tramos = [
    { id: 'a', clipId: 'x', inicio: 1.5, fin: 3 },
    { id: 'b', clipId: 'x', inicio: 0, fin: 1 },
  ];
  const s = subtitulosDe(p);
  assert.deepEqual(
    s.map((l) => l.texto),
    ['Hoy les cuento', 'Hola a todos.'],
  );
  // "Hoy" está en el segundo 2.0 del clip; el tramo empieza en 1.5 → 0.5 del video final.
  assert.ok(Math.abs(s[0].inicio - 0.5) < 1e-9);
  // La segunda línea va después del primer tramo (1.5 s).
  assert.ok(Math.abs(s[1].inicio - 1.5) < 1e-9);
});

test('subtítulos cortan las líneas largas', () => {
  const palabras = 'uno dos tres cuatro cinco seis siete'.split(' ').map((texto, i) => ({ texto, inicio: i * 0.3, fin: i * 0.3 + 0.25 }));
  const p = proyecto([clip('x', 5, palabras)]);
  p.tramos = [{ id: 'a', clipId: 'x', inicio: 0, fin: 5 }];
  const s = subtitulosDe(p);
  assert.ok(s.length >= 2);
  assert.ok(s.every((l) => l.texto.length <= 26));
});

test('colores y luminancia', () => {
  assert.equal(colorValido('#abc'), '#AABBCC');
  assert.equal(colorValido('#12345g'), '#FFFFFF');
  assert.ok(luminancia('#FFFFFF') > 0.9);
  assert.ok(luminancia('#000000') < 0.1);
});

test('animaciones: invisible fuera de tiempo, entra y sale', () => {
  assert.equal(animacionEn('aparecer', 1, 3, 0.5).opacidad, 0);
  assert.equal(animacionEn('aparecer', 1, 3, 3).opacidad, 0);
  assert.equal(animacionEn('aparecer', 1, 3, 2).opacidad, 1);
  assert.ok(animacionEn('subir', 1, 3, 1.05).dy > 0);
  assert.ok(animacionEn('zoom', 1, 3, 1.05).escala < 1);
  assert.ok(animacionEn('aparecer', 1, 3, 2.9).opacidad < 1);
});
