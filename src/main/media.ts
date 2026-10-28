import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import type { MediaItem, MediaKind } from '../shared/types'
import { mediaUrl } from '../shared/mediaUrl'

// Dentro del instalador el binario queda fuera del .asar, que no se puede ejecutar.
export const ffmpegPath = (ffmpegStatic ?? 'ffmpeg').replace('app.asar', 'app.asar.unpacked')

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'])
export const MEDIA_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', ...[...IMAGE_EXT, ...AUDIO_EXT].map((e) => e.slice(1))]

const thumbDir = join(tmpdir(), 'editor-video-miniaturas')

export function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

function parseInfo(stderr: string) {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const v = /Stream #\d+:\d+[^\n]*: Video: [^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
  let width = v ? Number(v[1]) : 0
  let height = v ? Number(v[2]) : 0
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr)
  if (rot && Math.abs(Number(rot[1])) % 180 === 90) [width, height] = [height, width]
  const hasAudio = /Stream #\d+:\d+[^\n]*: Audio:/.test(stderr)
  return { duration, width, height, hasVideo: Boolean(v), hasAudio }
}

export async function probe(path: string, id: string = randomUUID()): Promise<MediaItem | null> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', path])
  const info = parseInfo(stderr)
  const ext = extname(path).toLowerCase()
  let kind: MediaKind
  if (IMAGE_EXT.has(ext)) kind = 'image'
  else if (AUDIO_EXT.has(ext) || (!info.hasVideo && info.hasAudio)) kind = 'audio'
  else if (info.hasVideo) kind = 'video'
  else return null

  const item: MediaItem = {
    id,
    path,
    name: basename(path),
    kind,
    duration: kind === 'image' ? 0 : info.duration,
    width: info.width,
    height: info.height,
    hasAudio: kind !== 'image' && info.hasAudio
  }

  if (kind !== 'audio') {
    mkdirSync(thumbDir, { recursive: true })
    const out = join(thumbDir, `${id}.jpg`)
    const seek = kind === 'video' ? ['-ss', Math.min(1, info.duration / 2).toFixed(2)] : []
    const res = await runFfmpeg([...seek, '-i', path, '-frames:v', '1', '-vf', 'scale=240:-2', '-y', out])
    if (res.code === 0) item.thumb = mediaUrl(out) + `?v=${Date.now()}`
  }
  return item
}
