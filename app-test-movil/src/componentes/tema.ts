import { Platform, PlatformColor, type ColorValue } from 'react-native';

/**
 * Colores del sistema de iOS en modo oscuro (los mismos de las apps de Apple). En el iPhone
 * se piden al sistema con PlatformColor, así respetan "Aumentar contraste"; en otras plataformas
 * se usa el valor fijo equivalente.
 *
 * Igual que la app de computador: azul = resalte, amarillo = selección, rojo = cursor de reproducción.
 */
const c = (ios: string, otro: string): ColorValue => (Platform.OS === 'ios' ? PlatformColor(ios) : otro);

export const tema = {
  fondo: c('systemBackground', '#000000'),
  /** Celdas y tarjetas sobre el fondo. */
  tarjeta: c('secondarySystemBackground', '#1C1C1E'),
  /** Controles dentro de una tarjeta. */
  relleno: c('tertiarySystemBackground', '#2C2C2E'),
  gris: c('systemGray5', '#2C2C2E'),
  separador: c('separator', 'rgba(84,84,88,0.65)'),
  texto: c('label', '#FFFFFF'),
  suave: c('secondaryLabel', 'rgba(235,235,245,0.6)'),
  tenue: c('tertiaryLabel', 'rgba(235,235,245,0.3)'),
  acento: c('systemBlue', '#0A84FF'),
  seleccion: c('systemYellow', '#FFD60A'),
  cursor: c('systemRed', '#FF453A'),
  peligro: c('systemRed', '#FF453A'),
  ok: c('systemGreen', '#30D158'),
  morado: c('systemPurple', '#BF5AF2'),
  naranja: c('systemOrange', '#FF9F0A'),
};

/** Los mismos colores como texto, para lo que no acepta PlatformColor (navegación, sombras). */
export const temaFijo = {
  fondo: '#000000',
  tarjeta: '#1C1C1E',
  texto: '#FFFFFF',
  acento: '#0A84FF',
  separador: '#38383A',
};

/** Tamaños de letra de iOS (estilos de texto de Apple, tamaño grande por defecto). */
export const letra = {
  tituloGrande: { fontSize: 34, fontWeight: '700', letterSpacing: 0.4 },
  titulo2: { fontSize: 22, fontWeight: '700', letterSpacing: -0.26 },
  titulo3: { fontSize: 20, fontWeight: '600', letterSpacing: -0.45 },
  destacado: { fontSize: 17, fontWeight: '600', letterSpacing: -0.43 },
  cuerpo: { fontSize: 17, letterSpacing: -0.43 },
  llamada: { fontSize: 16, letterSpacing: -0.31 },
  subtitulo: { fontSize: 15, letterSpacing: -0.23 },
  nota: { fontSize: 13, letterSpacing: -0.08 },
  leyenda: { fontSize: 12 },
  leyenda2: { fontSize: 11, letterSpacing: 0.06 },
} as const;
