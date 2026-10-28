import { FORMATS } from '../shared/types.ts'
import type { Project } from '../shared/types'

export interface OverlayInput { path: string; start: number; end: number }

const audioFormat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
const number = (value: number): string => value.toFixed(3)

export function clipDuration(c: { in: number; out: number }): number {
  return Math.max(0, c.out - c.in)
}

export function sequenceDuration(project: Project): number {
  return project.clips.reduce((total, clip) => total + clipDuration(clip), 0)
}

export function buildFfmpegArgs(project: Project, overlays: OverlayInput[], outputPath: string): string[] {
  if (project.clips.length === 0) throw new Error('El proyecto no tiene clips.')

  const mediaById = new Map(project.media.map(item => [item.id, item]))
  for (const clip of project.clips) {
    if (!mediaById.has(clip.mediaId)) {
      throw new Error(`El clip ${clip.id} apunta a un medio inexistente.`)
    }
  }

  const clips = project.clips.filter(clip => clipDuration(clip) > 0)
  if (clips.length === 0) throw new Error('El proyecto no tiene clips con duración positiva.')

  const { width, height } = FORMATS[project.format]
  const total = clips.reduce((sum, clip) => sum + clipDuration(clip), 0)
  const args: string[] = ['-hide_banner']
  const filters: string[] = []
  const framing = project.fit === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`

  clips.forEach((clip, index) => {
    const media = mediaById.get(clip.mediaId)!
    const duration = number(clipDuration(clip))
    if (media.kind === 'video') {
      args.push('-ss', number(clip.in), '-t', duration, '-i', media.path)
    } else {
      args.push('-loop', '1', '-framerate', '30', '-t', duration, '-i', media.path)
    }
    filters.push(`[${index}:v]${framing},setsar=1,fps=30,format=yuv420p,trim=duration=${duration},setpts=PTS-STARTPTS[v${index}]`)
    if (media.kind === 'video' && media.hasAudio) {
      filters.push(`[${index}:a]aresample=48000,${audioFormat},volume=${number(clip.volume)},apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`)
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},${audioFormat},asetpts=PTS-STARTPTS[a${index}]`)
    }
  })

  overlays.forEach(overlay => {
    args.push('-loop', '1', '-framerate', '30', '-t', number(total), '-i', overlay.path)
  })

  let musicIndex: number | undefined
  if (project.music) {
    const music = mediaById.get(project.music.mediaId)
    if (!music) throw new Error('La música apunta a un medio inexistente.')
    musicIndex = clips.length + overlays.length
    args.push('-i', music.path)
  }

  const concatInputs = clips.map((_, index) => `[v${index}][a${index}]`).join('')
  filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[vcat][acat]`)

  if (overlays.length === 0) {
    filters.push('[vcat]null[vout]')
  } else {
    overlays.forEach((overlay, index) => {
      const previous = index === 0 ? 'vcat' : `vo${index}`
      const next = index === overlays.length - 1 ? 'vout' : `vo${index + 1}`
      filters.push(`[${previous}][${clips.length + index}:v]overlay=0:0:format=auto:enable='between(t,${number(overlay.start)},${number(overlay.end)})'[${next}]`)
    })
  }

  if (musicIndex !== undefined) {
    const music = project.music!
    const fade = music.fadeOut && total > 2 ? `,afade=t=out:st=${number(total - 2)}:d=2` : ''
    filters.push(`[${musicIndex}:a]aresample=48000,${audioFormat},volume=${number(music.volume)},atrim=duration=${number(total)}${fade},asetpts=PTS-STARTPTS[mus]`)
    filters.push('[acat][mus]amix=inputs=2:duration=first:normalize=0[aout]')
  } else {
    filters.push('[acat]anull[aout]')
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', '-y', outputPath)
  return args
}
