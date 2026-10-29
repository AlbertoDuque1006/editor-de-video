import { SymbolView, type AndroidSymbol, type SymbolViewProps } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import { tema } from './tema';

/**
 * Íconos de la app: SF Symbols en el iPhone (los de Apple) y Material Symbols en web,
 * que solo se usa para revisar el diseño en el Mac. No uses emojis como íconos.
 */
const ICONOS = {
  mas: ['plus', 'add'],
  ajustes: ['gearshape', 'settings'],
  ia: ['sparkles', 'auto_awesome'],
  video: ['film', 'movie'],
  videos: ['film.stack', 'video_library'],
  galeria: ['photo.badge.plus', 'add_photo_alternate'],
  musica: ['music.note', 'music_note'],
  texto: ['textformat', 'title'],
  subtitulos: ['captions.bubble', 'closed_caption'],
  sonido: ['speaker.wave.2', 'volume_up'],
  sinSonido: ['speaker.slash', 'volume_off'],
  tijeras: ['scissors', 'content_cut'],
  basura: ['trash', 'delete'],
  duplicar: ['plus.square.on.square', 'library_add'],
  play: ['play.fill', 'play_arrow'],
  pausa: ['pause.fill', 'pause'],
  alInicio: ['backward.end.fill', 'skip_previous'],
  deshacer: ['arrow.uturn.backward', 'undo'],
  rehacer: ['arrow.uturn.forward', 'redo'],
  compartir: ['square.and.arrow.up', 'ios_share'],
  enviar: ['arrow.up', 'arrow_upward'],
  check: ['checkmark', 'check'],
  checkCirculo: ['checkmark.circle.fill', 'check_circle'],
  cerrar: ['xmark', 'close'],
  flecha: ['chevron.right', 'chevron_right'],
  izquierda: ['arrow.left', 'arrow_back'],
  derecha: ['arrow.right', 'arrow_forward'],
  empiezaAqui: ['arrow.right.to.line', 'first_page'],
  terminaAqui: ['arrow.left.to.line', 'last_page'],
  zonaSegura: ['viewfinder', 'crop_free'],
  mas3: ['ellipsis', 'more_horiz'],
  copiar: ['doc.on.doc', 'content_copy'],
  lapiz: ['pencil', 'edit'],
  llave: ['key', 'key'],
  idioma: ['globe', 'language'],
  aviso: ['exclamationmark.triangle.fill', 'warning'],
  info: ['info.circle', 'info'],
  oido: ['ear', 'hearing'],
  vertical: ['rectangle.portrait', 'crop_portrait'],
  cuadrado: ['square', 'crop_square'],
  horizontal: ['rectangle', 'crop_landscape'],
  reloj: ['clock', 'schedule'],
  hashtag: ['number', 'tag'],
  rayo: ['bolt', 'bolt'],
  publicar: ['paperplane', 'send'],
  descargar: ['square.and.arrow.down', 'download'],
  circulo: ['circle', 'radio_button_unchecked'],
} as const satisfies Record<string, readonly [SFSymbol, AndroidSymbol]>;

export type NombreIcono = keyof typeof ICONOS;

export function Icono({
  nombre,
  tamano = 20,
  color = tema.acento,
  peso,
  estilo,
}: {
  nombre: NombreIcono;
  tamano?: number;
  color?: ColorValue;
  peso?: 'regular' | 'medium' | 'semibold' | 'bold';
  estilo?: StyleProp<ViewStyle>;
}) {
  const [ios, web] = ICONOS[nombre];
  const props: SymbolViewProps = {
    name: { ios, android: web, web },
    size: tamano,
    tintColor: color,
    style: [{ width: tamano, height: tamano }, estilo],
    resizeMode: 'scaleAspectFit',
  };
  if (peso) props.weight = peso;
  return <SymbolView {...props} />;
}

/** El nombre de SF Symbol, para los botones nativos de la barra y los menús. */
export const sf = (nombre: NombreIcono): SFSymbol => ICONOS[nombre][0];
