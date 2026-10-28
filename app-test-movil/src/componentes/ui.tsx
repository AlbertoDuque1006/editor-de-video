import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { tema } from '@/lib/estilos';

export function Boton({
  titulo,
  onPress,
  tipo = 'principal',
  cargando = false,
  deshabilitado = false,
  estilo,
}: {
  titulo: string;
  onPress: () => void;
  tipo?: 'principal' | 'secundario' | 'peligro';
  cargando?: boolean;
  deshabilitado?: boolean;
  estilo?: StyleProp<ViewStyle>;
}) {
  const inactivo = deshabilitado || cargando;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactivo}
      style={({ pressed }) => [
        s.boton,
        tipo === 'principal' && { backgroundColor: tema.acento },
        tipo === 'secundario' && { backgroundColor: tema.tarjeta, borderWidth: 1, borderColor: tema.borde },
        tipo === 'peligro' && { backgroundColor: '#3A1418' },
        (pressed || inactivo) && { opacity: 0.6 },
        estilo,
      ]}
    >
      {cargando ? <ActivityIndicator color={tema.texto} /> : <Text style={s.botonTexto}>{titulo}</Text>}
    </Pressable>
  );
}

export function Chip({ texto, activo, onPress }: { texto: string; activo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, activo && { backgroundColor: tema.texto, borderColor: tema.texto }]}>
      <Text style={[s.chipTexto, activo && { color: tema.fondo }]}>{texto}</Text>
    </Pressable>
  );
}

export function Fila({ children, estilo }: { children: ReactNode; estilo?: StyleProp<ViewStyle> }) {
  return <View style={[s.fila, estilo]}>{children}</View>;
}

export function Etiqueta({ children }: { children: ReactNode }) {
  return <Text style={s.etiqueta}>{children}</Text>;
}

/** Botón pequeño cuadrado con un símbolo, para ajustar tiempos y ordenar. */
export function Mini({ texto, onPress, deshabilitado }: { texto: string; onPress: () => void; deshabilitado?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} hitSlop={4} style={({ pressed }) => [s.mini, (pressed || deshabilitado) && { opacity: 0.4 }]}>
      <Text style={s.miniTexto}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  boton: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { color: tema.texto, fontSize: 16, fontWeight: '700' },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: tema.borde, paddingVertical: 7, paddingHorizontal: 13, backgroundColor: tema.tarjeta },
  chipTexto: { color: tema.texto, fontSize: 14, fontWeight: '600' },
  fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  etiqueta: { color: tema.suave, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  mini: { minWidth: 34, height: 34, borderRadius: 10, backgroundColor: tema.borde, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  miniTexto: { color: tema.texto, fontSize: 15, fontWeight: '700' },
});
