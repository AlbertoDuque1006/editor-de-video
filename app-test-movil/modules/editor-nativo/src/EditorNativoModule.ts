import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * Contrato con el código Swift (ios/). Tiempos en segundos, colores en #RRGGBB.
 * En Expo Go el módulo no existe: `EditorNativo` es null y la app lo avisa.
 */

export type Posicion = 'arriba' | 'centro' | 'abajo';
export type Estilo = 'titulo' | 'subtitulo' | 'etiqueta';
export type Animacion = 'aparecer' | 'subir' | 'zoom' | 'rebote';

/** Un pedazo de un clip, en el orden en que va en el video final. */
export interface TramoNativo {
  uri: string;
  inicio: number;
  fin: number;
}

/** Texto encima del video. inicio/fin son tiempos del video final. */
export interface TextoNativo {
  texto: string;
  inicio: number;
  fin: number;
  posicion: Posicion;
  estilo: Estilo;
  animacion: Animacion;
  color: string;
}

/** Una línea de subtítulo, en tiempos del video final. */
export interface SubtituloNativo {
  texto: string;
  inicio: number;
  fin: number;
}

export interface PedidoExportar {
  ancho: number;
  alto: number;
  tramos: TramoNativo[];
  textos: TextoNativo[];
  subtitulos: SubtituloNativo[];
  musica: { uri: string; volumen: number } | null;
  /** Volumen del sonido de los clips, de 0 a 1. */
  volumenOriginal: number;
}

export interface PalabraNativa {
  texto: string;
  inicio: number;
  fin: number;
}

type Eventos = {
  onProgreso(evento: { progreso: number }): void;
};

declare class EditorNativoModule extends NativeModule<Eventos> {
  /** Arma el video y devuelve la ruta file:// del .mp4 en la caché. */
  exportar(pedido: PedidoExportar): Promise<string>;
  /** Transcribe la voz del clip en el iPhone. idioma: por ejemplo 'es-CO'. */
  transcribir(uri: string, idioma: string): Promise<PalabraNativa[]>;
}

export default requireOptionalNativeModule<EditorNativoModule>('EditorNativo');
