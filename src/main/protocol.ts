import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME, pathFromMediaUrl } from '../shared/mediaUrl'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

// El reproductor de video pide el archivo por pedazos (Range); sin respuestas 206 no se puede adelantar.
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const path = pathFromMediaUrl(request.url)
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return new Response('No encontrado', { status: 404 })
    }
    const headers: Record<string, string> = {
      'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (range && size > 0) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  })
}
