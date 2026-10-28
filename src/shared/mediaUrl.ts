export const MEDIA_SCHEME = 'media'

/** URL con la que la interfaz puede leer un archivo local (ver el protocolo en src/main/protocol.ts). */
export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(path)}`
}

export function pathFromMediaUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1))
}
