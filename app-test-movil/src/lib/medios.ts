import { createVideoPlayer } from 'expo-video';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

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
