import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { copiarAlProyecto, PORTADA } from './almacen';

/** Duración y tamaño de un video cuando el selector no los trae. */
export function medirVideo(uri: string): Promise<{ duracion: number; ancho: number; alto: number }> {
  return new Promise((resolve, reject) => {
    const player = createVideoPlayer(uri);
    const fin = (r: () => void) => {
      clearTimeout(espera);
      sub.remove();
      player.release();
      r();
    };
    const espera = setTimeout(() => fin(() => reject(new Error('No se pudo leer el video'))), 10000);
    const sub = player.addListener('sourceLoad', ({ duration, availableVideoTracks }) => {
      const size = availableVideoTracks[0]?.size;
      fin(() => resolve({ duracion: duration, ancho: size?.width ?? 0, alto: size?.height ?? 0 }));
    });
  });
}

/** Fotos JPEG pequeñas (base64) de un clip, para que Claude vea de qué trata. */
export async function miniaturas(uri: string, duracion: number, cuantas: number): Promise<string[]> {
  const player = createVideoPlayer(uri);
  try {
    const tiempos = Array.from({ length: cuantas }, (_, i) => (duracion * (i + 0.5)) / cuantas);
    const fotos = await player.generateThumbnailsAsync(tiempos, { maxWidth: 512, maxHeight: 512 });
    const salida: string[] = [];
    for (const foto of fotos) {
      const imagen = await ImageManipulator.manipulate(foto).renderAsync();
      const r = await imagen.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
      if (r.base64) salida.push(r.base64);
    }
    return salida;
  } finally {
    player.release();
  }
}

/** Fotogramas pequeños de un clip en los segundos pedidos, para la línea de tiempo (se muestran con expo-image). */
export async function fotogramas(uri: string, tiempos: number[], altoMaximo: number): Promise<VideoThumbnail[]> {
  const player = createVideoPlayer(uri);
  try {
    return await player.generateThumbnailsAsync(tiempos, { maxHeight: altoMaximo, maxWidth: altoMaximo * 2 });
  } finally {
    player.release();
  }
}

/** Guarda en la carpeta del proyecto la foto de portada que se ve en la lista de videos. */
export async function guardarPortada(proyectoId: string, uriClip: string, segundo: number): Promise<void> {
  const player = createVideoPlayer(uriClip);
  try {
    const [foto] = await player.generateThumbnailsAsync([segundo], { maxWidth: 480, maxHeight: 480 });
    if (!foto) return;
    const imagen = await ImageManipulator.manipulate(foto).renderAsync();
    const r = await imagen.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    await copiarAlProyecto(proyectoId, r.uri, PORTADA);
  } finally {
    player.release();
  }
}
