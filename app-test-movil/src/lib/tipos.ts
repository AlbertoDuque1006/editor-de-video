import type { Animacion, Estilo, Posicion } from '../../modules/editor-nativo/src/EditorNativoModule.ts';

export type { Animacion, Estilo, Posicion };

export type Formato = '9:16' | '1:1' | '16:9';

export interface Palabra {
  texto: string;
  inicio: number;
  fin: number;
}

/** Un video que el usuario subió al proyecto. `archivo` es el nombre dentro de la carpeta del proyecto. */
export interface Clip {
  id: string;
  archivo: string;
  nombre: string;
  duracion: number;
  ancho: number;
  alto: number;
  /** Lo que dice la gente en el clip; null si no se ha transcrito. */
  transcripcion: Palabra[] | null;
  /** Lo que se ve en el clip, en pocas palabras (lo escribe la IA al mirarlo). */
  descripcion: string;
}

/** Un pedazo de un clip. Los tramos van en el orden del video final. */
export interface Tramo {
  id: string;
  clipId: string;
  inicio: number;
  fin: number;
}

/** Texto encima del video; inicio/fin en tiempo del video final. */
export interface Texto {
  id: string;
  texto: string;
  inicio: number;
  fin: number;
  posicion: Posicion;
  estilo: Estilo;
  animacion: Animacion;
  color: string;
}

export interface Musica {
  archivo: string;
  nombre: string;
  volumen: number;
}

export interface Publicacion {
  titulo: string;
  descripcion: string;
  hashtags: string[];
}

export interface MensajeChat {
  de: 'yo' | 'ia';
  texto: string;
}

export interface Proyecto {
  id: string;
  nombre: string;
  creado: number;
  editado: number;
  formato: Formato;
  /** Lo que el usuario pidió al crear el video. */
  pedido: string;
  duracionDeseada: number | null;
  clips: Clip[];
  tramos: Tramo[];
  textos: Texto[];
  subtitulos: boolean;
  musica: Musica | null;
  volumenOriginal: number;
  publicacion: Publicacion | null;
  chat: MensajeChat[];
}

export interface Subtitulo {
  texto: string;
  inicio: number;
  fin: number;
}
