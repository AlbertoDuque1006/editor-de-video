import test from 'node:test'
import assert from 'node:assert/strict'
import type { MediaItem, Project, VideoClip } from '../src/shared/types.ts'
import { emptyProject, newClip, newAudio, mainTrack } from '../src/shared/project.ts'
import { applyOps, type Op } from '../src/shared/ops.ts'

const video: MediaItem = { id: 'v', path: '/fake/video.mp4', name: 'video', kind: 'video', duration: 10, width: 1920, height: 1080, hasAudio: true }
const image: MediaItem = { id: 'i', path: '/fake/image.png', name: 'image', kind: 'image', duration: 0, width: 800, height: 400, hasAudio: false }
const audio: MediaItem = { id: 'a', path: '/fake/audio.mp3', name: 'audio', kind: 'audio', duration: 12, width: 0, height: 0, hasAudio: true }
function fixture(): Project {
  const p = emptyProject(); p.media = [video, image, audio]
  p.tracks[0].items = [newClip(video, { id: 'c', duration: 5 }), newClip(image, { id: 'im' })]
  p.tracks[2].items = [newAudio(audio, { id: 'aud', duration: 8 })]
  p.transcripts = [{ mediaId: 'v', language: 'es', words: [
    { text: 'Hola', start: 0.5, end: 1 }, { text: 'eh', start: 1.2, end: 1.5 },
    { text: 'mundo', start: 3, end: 3.5 }, { text: 'fuera', start: 8, end: 8.5 }
  ] }]
  return p
}
const run = (...ops: Op[]) => applyOps(fixture(), ops)
const clips = (p: Project) => mainTrack(p).items as VideoClip[]

test('todas las órdenes tienen caso feliz y al menos un error', () => {
  const cases: { name: string; ok: Op; bad: Op; check: (p: Project) => void }[] = [
    { name: 'set_format', ok: { op: 'set_format', format: '16:9' }, bad: { op: 'set_format', format: '3:2' }, check: p => assert.equal(p.format, '16:9') },
    { name: 'add_clip', ok: { op: 'add_clip', mediaId: 'v', ref: 'new', duration: 2 }, bad: { op: 'add_clip', mediaId: 'a' }, check: p => assert.equal(clips(p).length, 3) },
    { name: 'replace_main', ok: { op: 'replace_main', clips: [{ mediaId: 'i' }] }, bad: { op: 'replace_main', clips: 'x' }, check: p => assert.equal(clips(p).length, 1) },
    { name: 'update', ok: { op: 'update', id: 'c', speed: 2, volume: 3 }, bad: { op: 'update', id: 'missing', volume: 1 }, check: p => { assert.equal(clips(p)[0].speed, 2); assert.equal(clips(p)[0].volume, 2) } },
    { name: 'remove', ok: { op: 'remove', id: 'im' }, bad: { op: 'remove', id: 'missing' }, check: p => assert.equal(clips(p).length, 1) },
    { name: 'move', ok: { op: 'move', id: 'im', index: 0 }, bad: { op: 'move', id: 'im' }, check: p => assert.equal(clips(p)[0].id, 'im') },
    { name: 'split', ok: { op: 'split', id: 'c', at: 2, ref: 'right' }, bad: { op: 'split', id: 'c', at: 0.05 }, check: p => { assert.equal(clips(p).length, 3); assert.equal(clips(p)[1].in, 2) } },
    { name: 'add_text', ok: { op: 'add_text', text: 'Hola', start: 1, duration: 2 }, bad: { op: 'add_text', text: 'Hola', start: 0, duration: 1, style: { color: 'red' } }, check: p => assert.ok(p.tracks.some(t => t.items.some(i => i.type === 'text'))) },
    { name: 'add_shape', ok: { op: 'add_shape', shape: 'rect', start: 1, duration: 2, w: 0.5, h: 0.2, color: '#fff' }, bad: { op: 'add_shape', shape: 'triangle', start: 0, duration: 1, w: 1, h: 1, color: '#fff' }, check: p => assert.ok(p.tracks.some(t => t.items.some(i => i.type === 'shape'))) },
    { name: 'add_captions', ok: { op: 'add_captions' }, bad: { op: 'add_captions', preset: 'wrong' }, check: p => assert.equal(p.tracks.at(-1)?.name, 'Subtítulos') },
    { name: 'set_music', ok: { op: 'set_music', mediaId: 'a' }, bad: { op: 'set_music', mediaId: 'i' }, check: p => assert.equal(p.tracks.find(t => t.kind === 'audio')?.items.length, 1) },
    { name: 'set_logo', ok: { op: 'set_logo', mediaId: 'i', corner: 'top-right' }, bad: { op: 'set_logo', mediaId: 'v', corner: 'top-right' }, check: p => assert.equal(p.brand.logoMediaId, 'i') },
    { name: 'remove_ranges', ok: { op: 'remove_ranges', id: 'c', ranges: [{ start: 1, end: 2 }] }, bad: { op: 'remove_ranges', id: 'im', ranges: [] }, check: p => assert.equal(clips(p).length, 3) },
    { name: 'cut_silences', ok: { op: 'cut_silences' }, bad: { op: 'cut_silences', minGap: 'wrong' }, check: p => assert.equal(clips(p).length, 3) },
    { name: 'set_copy', ok: { op: 'set_copy', title: 'Título', hashtags: ['hola', '#mundo'] }, bad: { op: 'set_copy', hashtags: ['dos palabras'] }, check: p => assert.deepEqual(p.copy.hashtags, ['#hola', '#mundo']) },
    { name: 'set_brand', ok: { op: 'set_brand', primary: '#abc', font: 'Inter' }, bad: { op: 'set_brand', primary: 'white' }, check: p => assert.equal(p.brand.primary, '#abc') }
  ]
  for (const c of cases) {
    const good = run(c.ok); assert.deepEqual(good.errors, [], c.name); c.check(good.project)
    const bad = run(c.bad); assert.match(bad.errors[0] ?? '', new RegExp(`^Orden 1 \\(${c.name}\\): `), c.name)
  }
})

test('refs, inmutabilidad, clips acotados y normalización con transición', () => {
  const input = fixture(); const original = structuredClone(input)
  const result = applyOps(input, [
    { op: 'add_clip', mediaId: 'v', ref: 'nuevo', in: 9, duration: 5, speed: 2, transition: { type: 'fade', duration: 3 } },
    { op: 'update', id: '@nuevo', volume: -5, transform: { opacity: 5, scale: 100, x: -5 }, keyframes: { scale: [{ t: 2, v: 2, ease: 'linear' }, { t: 0, v: 1, ease: 'bounce' }] }, raro: true },
    { op: 'add_clip', mediaId: '@nuevo' }
  ])
  assert.deepEqual(input, original)
  assert.ok(result.created.nuevo)
  assert.match(result.errors[0], /^Orden 2 \(update\): campo desconocido: raro/)
  assert.match(result.errors[1], /^Orden 3 \(add_clip\):/)
  const c = clips(result.project)[2]
  assert.equal(c.duration, 0.5); assert.equal(c.volume, 0); assert.equal(c.transform.opacity, 1); assert.equal(c.transform.scale, 10); assert.equal(c.transform.x, -1)
  assert.deepEqual(c.keyframes.scale?.map(x => x.t), [0, 2])
  assert.equal(c.start, 7.75)
})

test('órdenes encadenadas, subtítulos convertidos, música y rangos', () => {
  const r = run(
    { op: 'split', id: 'c', at: 2, ref: 'part' },
    { op: 'update', id: '@part', speed: 2 },
    { op: 'add_captions', ref: 'subs' },
    { op: 'update', id: '@subs', maxWords: 4 },
    { op: 'set_music', mediaId: 'a', in: 1, ref: 'music' },
    { op: 'set_logo', mediaId: 'i', corner: 'bottom-left', size: 0.2, ref: 'logo' },
    { op: 'update', id: '@music', volume: 0.4 },
    { op: 'update', id: '@logo', transform: { opacity: 0.7 } },
    { op: 'remove_ranges', id: '@part', ranges: [{ start: 3, end: 3.3 }] }
  )
  assert.deepEqual(r.errors, [])
  const captions = r.project.tracks.flatMap(t => t.items).find(i => i.type === 'captions')
  assert.equal(captions?.maxWords, 4)
  assert.ok(captions?.words.some(w => w.text === 'Hola' && w.start === 0.5))
  assert.equal(r.project.tracks.find(t => t.kind === 'audio')?.items[0].type, 'audio')
  assert.ok(r.created.music && r.created.logo)
  assert.ok(r.project.tracks.some(t => t.name === 'Logo'))
})

test('update de tipos visuales y audio, borrado de keyframes y errores que no detienen la lista', () => {
  const r = run(
    { op: 'add_text', text: 'A', start: 0, duration: 1, ref: 'text', keyframes: { opacity: [{ t: 0, v: 0.2, ease: 'linear' }] } },
    { op: 'update', id: '@text', text: 'B', style: { size: 1 }, keyframes: { opacity: [] } },
    { op: 'add_shape', shape: 'circle', start: 0, duration: 1, w: 0.3, h: 0.3, color: '#123456', ref: 'shape' },
    { op: 'update', id: '@shape', radius: 2, color: '#12345678' },
    { op: 'update', id: 'aud', fadeIn: 8, volume: 3 },
    { op: 'unknown' },
    { op: 'set_format', format: '1:1' }
  )
  assert.equal(r.errors.length, 1); assert.equal(r.project.format, '1:1')
  const items = r.project.tracks.flatMap(t => t.items)
  const tx = items.find(i => i.type === 'text'); assert.equal(tx?.text, 'B'); assert.equal(tx?.style.size, 0.5); assert.deepEqual(tx?.keyframes, {})
  const sh = items.find(i => i.type === 'shape'); assert.equal(sh?.radius, 1)
  const au = items.find(i => i.type === 'audio'); assert.equal(au?.fadeIn, 5); assert.equal(au?.volume, 2)
})

test('split de imagen conserva su origen y música requiere duración visual', () => {
  const p = fixture()
  const split = applyOps(p, [{ op: 'split', id: 'im', at: 6.5 }])
  assert.deepEqual(split.errors, [])
  assert.equal(clips(split.project)[2].in, 0)
  p.tracks[0].items = []; p.tracks[1].items = []
  const music = applyOps(p, [{ op: 'set_music', mediaId: 'a' }])
  assert.match(music.errors[0], /^Orden 1 \(set_music\):/)
})

test('cut_silences deja intactos los clips sin voz', () => {
  const media = (id: string, duration: number): MediaItem => ({ id, path: `/fake/${id}.mp4`, name: id, kind: 'video', duration, width: 1280, height: 720, hasAudio: true })
  const voz = media('voz', 17)
  const broll = media('broll', 4)
  let p = emptyProject()
  p = { ...p, media: [voz, broll] }
  p = applyOps(p, [{ op: 'add_clip', mediaId: voz.id }, { op: 'add_clip', mediaId: broll.id }]).project
  const w = (start: number, end: number) => ({ text: 'hola', start, end })
  p = { ...p, transcripts: [{ mediaId: voz.id, language: 'es', words: [w(0.2, 2), w(9.7, 11)] }, { mediaId: broll.id, language: 'es', words: [] }] }
  const r = applyOps(p, [{ op: 'cut_silences' }])
  assert.deepEqual(r.errors, [])
  const items = mainTrack(r.project).items as VideoClip[]
  assert.equal(items.length, 3)
  assert.equal(items[2].mediaId, broll.id)
  assert.equal(items[2].duration, 4)
})
