import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { copiarAlProyecto, PORTADA } from './almacen';

/** Espera los metadatos antes de pedir fotogramas al reproductor. */
function abrirVideo(uri: string): Promise<{ player: ReturnType<typeof createVideoPlayer>; duracion: number; ancho: number; alto: number }> {
  return new Promise((resolve, reject) => {
    const player = createVideoPlayer(uri);
    const limpiar = () => {
      clearTimeout(espera);
      subCarga.remove();
      subEstado.remove();
    };
    const fallar = () => {
      limpiar();
      player.release();
      reject(new Error('No se pudo leer el video'));
    };
    const subCarga = player.addListener('sourceLoad', ({ duration, availableVideoTracks }) => {
      limpiar();
      const size = availableVideoTracks[0]?.size;
      resolve({ player, duracion: duration, ancho: size?.width ?? 0, alto: size?.height ?? 0 });
    });
    const subEstado = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') fallar();
    });
    const espera = setTimeout(fallar, 10000);
  });
}

/** Duración y tamaño de un video cuando el selector no los trae. */
export async function medirVideo(uri: string): Promise<{ duracion: number; ancho: number; alto: number }> {
  const { player, duracion, ancho, alto } = await abrirVideo(uri);
  try {
    return { duracion, ancho, alto };
  } finally {
    player.release();
  }
}

/** Fotos JPEG pequeñas (base64) de un clip, para que Claude vea de qué trata. */
export async function miniaturas(uri: string, duracion: number, cuantas: number): Promise<string[]> {
  const { player } = await abrirVideo(uri);
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
  const { player } = await abrirVideo(uri);
  try {
    return await player.generateThumbnailsAsync(tiempos, { maxHeight: altoMaximo, maxWidth: altoMaximo * 2 });
  } finally {
    player.release();
  }
}

/** Guarda en la carpeta del proyecto la foto de portada que se ve en la lista de videos. */
export async function guardarPortada(proyectoId: string, uriClip: string, segundo: number): Promise<void> {
  const { player } = await abrirVideo(uriClip);
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
