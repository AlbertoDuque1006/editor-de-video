import { StyleSheet, Text, View } from 'react-native';
import {
  ANCHO_TEXTO,
  CENTRO_Y,
  CENTRO_Y_SUBTITULOS,
  PESO,
  TAMANO,
  TAMANO_SUBTITULOS,
  animacionEn,
} from '@/lib/estilos';
import { luminancia, textosEn } from '@/lib/proyecto';
import type { Subtitulo, Texto } from '@/lib/tipos';

/** Franja horizontal centrada en `cy` (fracción del alto) donde se centra el bloque de texto. */
function franja(cy: number, ancho: number, alto: number) {
  const h = 2 * Math.min(cy, 1 - cy);
  return { top: (cy - h / 2) * alto, height: h * alto, left: ((1 - ANCHO_TEXTO) / 2) * ancho, width: ANCHO_TEXTO * ancho };
}

const sombra = (W: number) => ({
  textShadowColor: 'rgba(0,0,0,0.5)',
  textShadowRadius: 0.006 * W,
  textShadowOffset: { width: 0, height: 0.003 * W },
});

function UnTexto({ x, t, ancho, alto }: { x: Texto; t: number; ancho: number; alto: number }) {
  const a = animacionEn(x.animacion, x.inicio, x.fin, t);
  const tamano = TAMANO[x.estilo] * ancho;
  const etiqueta = x.estilo === 'etiqueta';
  return (
    <View style={[s.franja, franja(CENTRO_Y[x.posicion], ancho, alto)]} pointerEvents="none">
      <View
        style={[
          { opacity: a.opacidad, transform: [{ translateY: a.dy * alto }, { scale: a.escala }] },
          etiqueta && {
            backgroundColor: x.color,
            borderRadius: 0.02 * ancho,
            paddingHorizontal: 0.025 * ancho,
            paddingVertical: 0.012 * ancho,
          },
        ]}
      >
        <Text
          numberOfLines={3}
          style={[
            s.texto,
            { fontSize: tamano, fontWeight: PESO[x.estilo] },
            etiqueta ? { color: luminancia(x.color) > 0.6 ? '#000' : '#FFF' } : { color: x.color, ...sombra(ancho) },
          ]}
        >
          {x.texto}
        </Text>
      </View>
    </View>
  );
}

export function CapaTextos({
  textos,
  subtitulos,
  t,
  ancho,
  alto,
}: {
  textos: Texto[];
  subtitulos: Subtitulo[];
  t: number;
  ancho: number;
  alto: number;
}) {
  const linea = subtitulos.find((l) => t >= l.inicio && t < l.fin);
  return (
    <>
      {textosEn(textos, t).map((x) => (
        <UnTexto key={x.id} x={x} t={t} ancho={ancho} alto={alto} />
      ))}
      {linea && (
        <View style={[s.franja, franja(CENTRO_Y_SUBTITULOS, ancho, alto)]} pointerEvents="none">
          <View
            style={{
              backgroundColor: 'rgba(0,0,0,0.55)',
              borderRadius: 0.015 * ancho,
              paddingHorizontal: 0.02 * ancho,
              paddingVertical: 0.008 * ancho,
            }}
          >
            <Text numberOfLines={3} style={[s.texto, { fontSize: TAMANO_SUBTITULOS * ancho, fontWeight: '700', color: '#FFF' }]}>
              {linea.texto}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  franja: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  texto: { textAlign: 'center' },
});
