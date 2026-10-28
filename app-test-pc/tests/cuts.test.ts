import test from 'node:test'
import assert from 'node:assert/strict'
import { isFiller, planKeep, DEFAULT_CUTS } from '../src/shared/cuts.ts'

test('reconoce muletillas con puntuación y espacios', () => {
  for (const word of ['eh', 'Eeh!', ' em, ', 'mmm', 'ah', 'hmm', 'ehm']) assert.equal(isFiller(word), true, word)
  for (const word of ['hola', 'hoy', '']) assert.equal(isFiller(word), false, word)
  assert.deepEqual(DEFAULT_CUTS, { minGap: 0.6, pad: 0.12, fillers: true })
})

test('planKeep recorta al rango, aplica pad y une huecos pequeños o tramos que se tocan', () => {
  const words = [
    { text: 'fuera', start: -2, end: -1 },
    { text: 'uno', start: 0.2, end: 0.4 },
    { text: 'dos', start: 0.8, end: 1 },
    { text: 'tres', start: 2, end: 2.2 },
    { text: 'fin', start: 3.9, end: 4.3 }
  ]
  assert.deepEqual(planKeep(words, 0, 4).map(s => ({ start: +s.start.toFixed(2), end: +s.end.toFixed(2) })), [{ start: 0.08, end: 1.12 }, { start: 1.88, end: 2.32 }, { start: 3.78, end: 4 }])
  assert.deepEqual(planKeep(words, 0, 4, { minGap: 0.01, pad: 0.2 }).slice(0, 1).map(s => ({ start: +s.start.toFixed(2), end: +s.end.toFixed(2) })), [{ start: 0, end: 1.2 }])
  assert.deepEqual(planKeep([{ text: 'a', start: 0, end: 0.3 }, { text: 'b', start: 0.3, end: 0.6 }], 0, 1, { minGap: 0, pad: 0 }), [{ start: 0, end: 0.6 }])
})

test('descarta muletillas, respeta opción fillers y elimina rangos vacíos/cortos', () => {
  const words = [{ text: 'eh', start: 0, end: 0.5 }, { text: 'hola', start: 1, end: 1.04 }]
  assert.deepEqual(planKeep(words, 0, 2, { pad: 0 }), [])
  assert.deepEqual(planKeep(words, 0, 2, { pad: 0, fillers: false }), [{ start: 0, end: 1.04 }])
  assert.deepEqual(planKeep(words, 2, 1), [])
  assert.deepEqual(planKeep([], 0, 2), [])
  assert.deepEqual(planKeep([{ text: 'sí', start: -1, end: 0.2 }], 0, 1, { pad: 0 }), [{ start: 0, end: 0.2 }])
})
