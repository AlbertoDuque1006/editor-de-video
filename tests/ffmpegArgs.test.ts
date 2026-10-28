import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Project } from '../src/shared/types.ts'
import { buildFfmpegArgs, clipDuration, sequenceDuration } from '../src/main/ffmpegArgs.ts'

const ffmpeg = join(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg')

function project(): Project {
  return {
    format: '9:16', fit: 'cover', texts: [], logo: null, music: null,
    media: [
      { id: 'v', path: '/media/video file.mp4', name: 'video', kind: 'video', duration: 4, width: 640, height: 360, hasAudio: true },
      { id: 'i', path: '/media/image.png', name: 'image', kind: 'image', duration: 0, width: 640, height: 360, hasAudio: false },
      { id: 'm', path: '/media/music.wav', name: 'music', kind: 'audio', duration: 4, width: 0, height: 0, hasAudio: true }
    ],
    clips: [
      { id: 'c1', mediaId: 'v', in: 0.25, out: 1.5, volume: 0.75 },
      { id: 'c2', mediaId: 'i', in: 0, out: 1, volume: 1 }
    ]
  }
}

function graph(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1]
}

test('duraciones y orden de entradas, con números de tres decimales', () => {
  const p = project()
  assert.equal(clipDuration({ in: 2, out: 1 }), 0)
  assert.equal(sequenceDuration(p), 2.25)
  const args = buildFfmpegArgs(p, [{ path: '/overlay one.png', start: 0.1, end: 1.8 }], '/out file.mp4')
  assert.deepEqual(args.slice(0, 23), [
    '-hide_banner', '-ss', '0.250', '-t', '1.250', '-i', '/media/video file.mp4',
    '-loop', '1', '-framerate', '30', '-t', '1.000', '-i', '/media/image.png',
    '-loop', '1', '-framerate', '30', '-t', '2.250', '-i', '/overlay one.png'
  ])
  assert.equal(args.at(-1), '/out file.mp4')
  assert.match(graph(args), /\[0:v\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/)
  assert.match(graph(args), /\[0:a\]aresample=48000,.*volume=0\.750,apad,atrim=duration=1\.250/)
  assert.match(graph(args), /anullsrc=r=48000:cl=stereo,atrim=duration=1\.000/)
  assert.match(graph(args), /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[vcat\]\[acat\]/)
})

test('contain, silencio y clips de duración cero', () => {
  const p = project()
  p.fit = 'contain'
  p.media[0].hasAudio = false
  p.clips.push({ id: 'zero', mediaId: 'v', in: 2, out: 2, volume: 1 })
  const args = buildFfmpegArgs(p, [], '/out.mp4')
  assert.match(graph(args), /scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black/)
  assert.match(graph(args), /\[vcat\]null\[vout\]/)
  assert.match(graph(args), /\[acat\]anull\[aout\]/)
  assert.doesNotMatch(graph(args), /\[0:a\]/)
  assert.doesNotMatch(graph(args), /concat=n=3/)
})

test('overlays encadenados y música con fade', () => {
  const p = project()
  p.music = { mediaId: 'm', volume: 0.5, fadeOut: true }
  const args = buildFfmpegArgs(p, [
    { path: '/one.png', start: 0, end: 1 },
    { path: '/two.png', start: 1, end: 2 }
  ], '/out.mp4')
  assert.deepEqual(args.slice(31, 33), ['-i', '/media/music.wav'])
  assert.match(graph(args), /\[vcat\]\[2:v\]overlay=0:0:format=auto:enable='between\(t,0\.000,1\.000\)'\[vo1\]/)
  assert.match(graph(args), /\[vo1\]\[3:v\]overlay=0:0:format=auto:enable='between\(t,1\.000,2\.000\)'\[vout\]/)
  assert.match(graph(args), /\[4:a\].*volume=0\.500,atrim=duration=2\.250,afade=t=out:st=0\.250:d=2,asetpts=PTS-STARTPTS\[mus\]/)
  assert.match(graph(args), /\[acat\]\[mus\]amix=inputs=2:duration=first:normalize=0\[aout\]/)

  p.music.fadeOut = false
  assert.doesNotMatch(graph(buildFfmpegArgs(p, [], '/out.mp4')), /afade=/)
  p.music.fadeOut = true
  p.clips[1].out = 0.25
  assert.doesNotMatch(graph(buildFfmpegArgs(p, [], '/out.mp4')), /afade=/)
})

test('errores por clips y medios inexistentes', () => {
  const p = project()
  p.clips = []
  assert.throws(() => buildFfmpegArgs(p, [], '/out.mp4'), /no tiene clips/)
  p.clips = [{ id: 'roto', mediaId: 'missing', in: 0, out: 1, volume: 1 }]
  assert.throws(() => buildFfmpegArgs(p, [], '/out.mp4'), /medio inexistente/)
  p.clips[0].mediaId = 'v'
  p.clips[0].out = 0
  assert.throws(() => buildFfmpegArgs(p, [], '/out.mp4'), /duración positiva/)
})

function run(args: string[]): string {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
  assert.equal(result.status, 0, `FFmpeg falló: ${result.stderr}`)
  return result.stderr
}

test('integración: exporta MP4 vertical con audio, imagen, overlay y música', { skip: !existsSync(ffmpeg), timeout: 180_000 }, () => {
  const dir = join(process.cwd(), 'tests/.tmp')
  mkdirSync(dir, { recursive: true })
  try {
    const videoAudio = join(dir, 'audio.mp4')
    const videoSilent = join(dir, 'silent.mp4')
    const image = join(dir, 'image.png')
    const overlay = join(dir, 'overlay.png')
    const music = join(dir, 'music.wav')
    const output = join(dir, 'result.mp4')
    run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', videoAudio])
    run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '3', '-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', '-y', videoSilent])
    run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360', '-frames:v', '1', '-threads', '1', '-y', image])
    run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=1080x1920', '-vf', 'format=rgba', '-frames:v', '1', '-threads', '1', '-y', overlay])
    run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '3', '-y', music])

    const p = project()
    p.media[0].path = videoAudio
    p.media[1].path = image
    p.media[2].path = music
    p.media.push({ id: 's', path: videoSilent, name: 'silent', kind: 'video', duration: 3, width: 640, height: 360, hasAudio: false })
    p.clips = [
      { id: 'c1', mediaId: 'v', in: 0.2, out: 0.7, volume: 1 },
      { id: 'c2', mediaId: 's', in: 0.3, out: 0.8, volume: 1 },
      { id: 'c3', mediaId: 'i', in: 0, out: 0.5, volume: 1 }
    ]
    p.music = { mediaId: 'm', volume: 0.25, fadeOut: false }
    run(buildFfmpegArgs(p, [{ path: overlay, start: 0.2, end: 1.2 }], output))
    assert.ok(statSync(output).size > 0)
    const inspection = spawnSync(ffmpeg, ['-hide_banner', '-i', output], { encoding: 'utf8' }).stderr
    assert.match(inspection, /1080x1920/)
    const duration = Number(inspection.match(/Duration: (\d+):(\d+):(\d+\.\d+)/)?.slice(1).reduce((seconds, part) => seconds * 60 + Number(part), 0))
    assert.ok(Math.abs(duration - sequenceDuration(p)) <= 0.15, `Duración ${duration} frente a ${sequenceDuration(p)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
