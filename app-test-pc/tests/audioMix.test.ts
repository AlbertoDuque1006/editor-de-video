import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { atempoChain, buildMuxArgs } from '../src/main/audioMix.ts'
import { emptyProject, newAudio, newClip, normalizeProject, totalDuration } from '../src/shared/project.ts'
import type { MediaItem, Project } from '../src/shared/types.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ffmpeg = path.join(root, 'node_modules/ffmpeg-static/ffmpeg')
const media = (id: string, kind: MediaItem['kind'], duration = 2): MediaItem => ({
  id, path: `/tmp/${id}.mp4`, name: id, kind, duration, width: 16, height: 16, hasAudio: kind !== 'image'
})
const argsFor = (project: Project, h264 = true): string[] => buildMuxArgs(project, { path: '/tmp/video.mp4', h264 }, '/tmp/final.mp4')
const graphOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1]

test('atempoChain descompone velocidades y deja 1 intacto', () => {
  for (const [speed, expected] of [
    [1, []], [2, ['atempo=2.000']], [4, ['atempo=2.000', 'atempo=2.000']],
    [0.25, ['atempo=0.500', 'atempo=0.500']], [0.75, ['atempo=0.750']]
  ] as const) assert.deepEqual(atempoChain(speed), expected)
})

test('entradas ordenadas, limitadas al protocolo file y filtros por fuente', () => {
  const p = emptyProject()
  const a = media('main', 'video')
  const b = media('overlay', 'video')
  const c = media('music', 'audio')
  p.media.push(a, b, c)
  p.tracks[0].items.push(newClip(a, { duration: 1, in: 0.25, speed: 2 }))
  p.tracks[1].items.push(newClip(b, { duration: 1, start: 0.2 }))
  p.tracks[2].items.push(newAudio(c, { duration: 1, start: 0.3, fadeIn: 0.2, fadeOut: 0.4 }))
  const args = argsFor(p)
  assert.deepEqual(args.slice(0, 5), ['-hide_banner', '-protocol_whitelist', 'file', '-i', '/tmp/video.mp4'])
  const inputIndices = args.flatMap((arg, i) => arg === '-i' ? [i] : [])
  assert.deepEqual(inputIndices.map(i => args[i + 1]), ['/tmp/video.mp4', a.path, b.path, c.path])
  for (const i of inputIndices) assert.deepEqual(args.slice(i - 2, i), ['-protocol_whitelist', 'file'])
  assert.deepEqual(args.slice(inputIndices[1] - 6, inputIndices[1]), ['-ss', '0.250', '-t', '2.000', '-protocol_whitelist', 'file'])
  const graph = graphOf(args)
  assert.match(graph, /\[1:a\]aresample=48000,aformat=.*atempo=2\.000,volume=1\.000,adelay=delays=0:all=1\[s0\]/)
  assert.match(graph, /afade=t=in:st=0:d=0\.200,afade=t=out:st=0\.600:d=0\.400,adelay=delays=300:all=1\[s2\]/)
  assert.match(graph, /\[s0\]\[s1\]\[s2\]amix=inputs=3:duration=longest:normalize=0\[mix\]/)
})

test('fundidos de AudioItem se limitan a su duración', () => {
  const p = emptyProject()
  const a = media('audio', 'audio')
  p.media.push(a)
  p.tracks[2].items.push(newAudio(a, { duration: 0.8, fadeIn: 2, fadeOut: 2 }))
  assert.match(graphOf(argsFor(p)), /afade=t=in:st=0:d=0\.800,afade=t=out:st=0\.000:d=0\.800/)
})

test('la transición principal cruza los fundidos de ambos clips', () => {
  const p = emptyProject()
  const a = media('one', 'video')
  const b = media('two', 'video')
  p.media.push(a, b)
  p.tracks[0].items.push(newClip(a, { duration: 1 }), newClip(b, { duration: 1, transition: { type: 'fade', duration: 0.5 } }))
  const graph = graphOf(argsFor(normalizeProject(p)))
  assert.match(graph, /\[1:a\].*afade=t=out:st=0\.500:d=0\.500,adelay=delays=0:all=1\[s0\]/)
  assert.match(graph, /\[2:a\].*afade=t=in:st=0:d=0\.500,adelay=delays=500:all=1\[s1\]/)
  assert.match(graph, /atrim=duration=1\.500/)
})

test('ignora pistas silenciadas u ocultas y usa silencio si no hay fuentes', () => {
  const p = emptyProject()
  const a = media('one', 'video')
  const b = media('two', 'audio')
  p.media.push(a, b)
  p.tracks[0].items.push(newClip(a, { duration: 1, volume: 0 }))
  p.tracks[1].muted = true
  p.tracks[1].items.push(newClip(a))
  p.tracks[2].hidden = true
  p.tracks[2].items.push(newAudio(b))
  const args = argsFor(p)
  assert.equal(args.filter(arg => arg === '-i').length, 1)
  assert.match(graphOf(args), /anullsrc=r=48000:cl=stereo\[mix\]/)
})

test('copia H.264 o recodifica otros formatos', () => {
  const p = emptyProject()
  p.tracks[0].items.push(newClip(media('still', 'image'), { duration: 1 }))
  const copyArgs = argsFor(p)
  assert.deepEqual(copyArgs.slice(copyArgs.indexOf('-c:v'), copyArgs.indexOf('-c:v') + 2), ['-c:v', 'copy'])
  assert.match(argsFor(p, false).join(' '), /-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p/)
})

test('rechaza proyectos vacíos, rutas relativas y medios inexistentes', () => {
  assert.throws(() => argsFor(emptyProject()), /duración/)
  const p = emptyProject()
  const a = media('one', 'video')
  p.media.push(a)
  p.tracks[0].items.push(newClip(a, { duration: 1 }))
  assert.throws(() => buildMuxArgs(p, { path: 'relative.mp4', h264: true }, '/tmp/out.mp4'), /absolutas/)
  assert.throws(() => buildMuxArgs(p, { path: '/tmp/video.mp4', h264: true }, 'relative.mp4'), /absolutas/)
  a.path = 'relative.mp4'
  assert.throws(() => argsFor(p), /absoluta/)
  p.media.length = 0
  assert.throws(() => argsFor(p), /No existe el medio/)
})

test('FFmpeg une audio con H.264 y recodifica MPEG-4', { skip: !existsSync(ffmpeg), timeout: 120_000 }, () => {
  const base = path.join(root, 'tests/.tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(path.join(base, 'audio-mix-'))
  const run = (args: string[]): string => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', timeout: 90_000 })
    assert.equal(result.status, 0, `FFmpeg falló: ${result.stderr}`)
    return result.stderr
  }
  try {
    const h264 = path.join(dir, 'video-h264.mp4')
    const mpeg4 = path.join(dir, 'video-mpeg4.mp4')
    const clipPath = path.join(dir, 'clip.mp4')
    const wavPath = path.join(dir, 'music.wav')
    run(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=10:d=1.5', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', h264])
    run(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=10:d=1.5', '-an', '-c:v', 'mpeg4', '-q:v', '5', '-y', mpeg4])
    run(['-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=10:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', clipPath])
    run(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', '-y', wavPath])

    const p = emptyProject()
    const clip: MediaItem = { ...media('clip', 'video'), path: clipPath }
    const music: MediaItem = { ...media('music', 'audio'), path: wavPath }
    p.media.push(clip, music)
    p.tracks[0].items.push(
      newClip(clip, { duration: 1, speed: 2 }),
      newClip(clip, { duration: 1, in: 0.5, transition: { type: 'fade', duration: 0.5 } })
    )
    p.tracks[2].items.push(newAudio(music, { duration: 1.5, fadeIn: 0.2, fadeOut: 0.2 }))
    const project = normalizeProject(p)
    assert.equal(totalDuration(project), 1.5)
    for (const [input, copy] of [[h264, true], [mpeg4, false]] as const) {
      const output = path.join(dir, copy ? 'copy.mp4' : 'encode.mp4')
      run(buildMuxArgs(project, { path: input, h264: copy }, output))
      const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', output], { encoding: 'utf8' }).stderr
      assert.match(probe, /Video: h264/)
      assert.match(probe, /Audio: aac/)
      const duration = Number(probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/)?.[3])
      assert.ok(Number.isFinite(duration) && Math.abs(duration - totalDuration(project)) <= 0.15, probe)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(base, { recursive: true, force: true })
  }
})
