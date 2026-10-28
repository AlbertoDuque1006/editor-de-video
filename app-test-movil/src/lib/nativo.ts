import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { EditorNativo, type PedidoExportar } from '../../modules/editor-nativo';
import { uriDe } from './almacen';
import { leerIdioma } from './ajustes';
import { FORMATOS, subtitulosDe } from './proyecto';
import type { Clip, Palabra, Proyecto } from './tipos';

/** El módulo nativo solo existe en la app instalada (build); en Expo Go es null. */
export const hayNativo = EditorNativo !== null;

export const AVISO_EXPO_GO =
  'Esto necesita la app instalada en el iPhone. En Expo Go no está disponible. Mira las instrucciones en el CLAUDE.md del proyecto.';

export async function transcribirClip(proyectoId: string, clip: Clip): Promise<Palabra[]> {
  if (!EditorNativo) throw new Error(AVISO_EXPO_GO);
  return EditorNativo.transcribir(uriDe(proyectoId, clip.archivo), await leerIdioma());
}

export function pedidoExportar(p: Proyecto): PedidoExportar {
  const clips = new Map(p.clips.map((c) => [c.id, c]));
  const { ancho, alto } = FORMATOS[p.formato];
  return {
    ancho,
    alto,
    tramos: p.tramos.flatMap((t) => {
      const c = clips.get(t.clipId);
      return c ? [{ uri: uriDe(p.id, c.archivo), inicio: t.inicio, fin: t.fin }] : [];
    }),
    textos: p.textos.map(({ id: _id, ...t }) => t),
    subtitulos: p.subtitulos ? subtitulosDe(p) : [],
    musica: p.musica ? { uri: uriDe(p.id, p.musica.archivo), volumen: p.musica.volumen } : null,
    volumenOriginal: p.volumenOriginal,
  };
}

/** Exporta el video y lo guarda en Fotos. Devuelve la ruta del .mp4. */
export async function exportar(p: Proyecto, progreso: (v: number) => void): Promise<string> {
  if (!EditorNativo) throw new Error(AVISO_EXPO_GO);
  const sub = EditorNativo.addListener('onProgreso', (e) => progreso(e.progreso));
  try {
    const uri = await EditorNativo.exportar(pedidoExportar(p));
    const permiso = await requestPermissionsAsync(true, ['video']);
    if (permiso.status === 'granted') await Asset.create(uri);
    return uri;
  } finally {
    sub.remove();
  }
}
