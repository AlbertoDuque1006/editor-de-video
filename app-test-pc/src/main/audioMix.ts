import path from 'node:path'
import type { AudioItem, Project, VideoClip } from '../shared/types.ts'
import { findMedia, totalDuration, transitionDuration } from '../shared/project.ts'

const seconds = (value: number): string => value.toFixed(3)

export function atempoChain(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('La velocidad de audio debe ser positiva y finita')
  const filters: string[] = []
  while (speed > 2) {
    filters.push('atempo=2.000')
    speed /= 2
  }
  while (speed < 0.5) {
    filters.push('atempo=0.500')
    speed *= 2
  }
  if (speed !== 1) filters.push(`atempo=${seconds(speed)}`)
  return filters
}

export function buildMuxArgs(project: Project, video: { path: string; h264: boolean }, outputPath: string): string[] {
  const total = totalDuration(project)
  if (!Number.isFinite(total) || total <= 0) throw new Error('El proyecto debe tener una duración positiva')
  if (!path.isAbsolute(video.path) || !path.isAbsolute(outputPath)) {
    throw new Error('Las rutas del video y la salida deben ser absolutas')
  }

  const args = ['-hide_banner', '-protocol_whitelist', 'file', '-i', video.path]
  const filters: string[] = []
  let sourceCount = 0

  for (const track of project.tracks) {
    if (track.muted || track.hidden) continue
    for (let index = 0; index < track.items.length; index++) {
      const item = track.items[index]
      const isClip = item.type === 'video' && (track.kind === 'main' || track.kind === 'overlay')
      const isAudio = item.type === 'audio' && track.kind === 'audio'
      if (!isClip && !isAudio) continue
      const media = findMedia(project, item.mediaId)
      if (!media) throw new Error(`No existe el medio del elemento ${item.id}`)
      if (item.volume <= 0 || (isClip && !media.hasAudio)) continue
      if (!path.isAbsolute(media.path)) throw new Error(`La ruta del medio ${media.id} debe ser absoluta`)

      const inputDuration = isClip ? item.duration * item.speed : item.duration
      args.push('-ss', seconds(item.in), '-t', seconds(inputDuration), '-protocol_whitelist', 'file', '-i', media.path)
      const parts = [
        `[${sourceCount + 1}:a]aresample=48000`,
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
      ]
      if (isClip) parts.push(...atempoChain(item.speed))
      parts.push(`volume=${seconds(item.volume)}`)

      if (isAudio) {
        const audio = item as AudioItem
        const fadeIn = Math.min(Math.max(audio.fadeIn, 0), audio.duration)
        const fadeOut = Math.min(Math.max(audio.fadeOut, 0), audio.duration)
        if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${seconds(fadeIn)}`)
        if (fadeOut > 0) parts.push(`afade=t=out:st=${seconds(audio.duration - fadeOut)}:d=${seconds(fadeOut)}`)
      } else if (track.kind === 'main') {
        const clip = item as VideoClip
        const prev = track.items[index - 1]
        const next = track.items[index + 1]
        const fadeIn = transitionDuration(prev?.type === 'video' || prev?.type === 'image' ? prev : undefined, clip)
        const fadeOut = next?.type === 'video' || next?.type === 'image' ? transitionDuration(clip, next) : 0
        if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${seconds(fadeIn)}`)
        if (fadeOut > 0) parts.push(`afade=t=out:st=${seconds(clip.duration - fadeOut)}:d=${seconds(fadeOut)}`)
      }
      parts.push(`adelay=delays=${Math.round(item.start * 1000)}:all=1[s${sourceCount}]`)
      filters.push(parts.join(','))
      sourceCount++
    }
  }

  if (sourceCount >= 2) {
    filters.push(`${Array.from({ length: sourceCount }, (_, i) => `[s${i}]`).join('')}amix=inputs=${sourceCount}:duration=longest:normalize=0[mix]`)
  } else if (sourceCount === 1) {
    filters.push('[s0]anull[mix]')
  } else {
    filters.push('anullsrc=r=48000:cl=stereo[mix]')
  }
  filters.push(`[mix]apad,atrim=duration=${seconds(total)},asetpts=PTS-STARTPTS[aout]`)
  args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]')
  if (video.h264) args.push('-c:v', 'copy')
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p')
  args.push('-c:a', 'aac', '-b:a', '192k', '-t', seconds(total), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-y', outputPath)
  return args
}
