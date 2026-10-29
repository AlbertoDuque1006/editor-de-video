import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import SegmentedControl from '@expo/ui/community/segmented-control';
import * as Haptics from 'expo-haptics';
import { Icono, type NombreIcono } from './Icono';
import { letra, tema } from './tema';

/** Vibración corta al tocar, como en las apps de Apple. Nunca falla (en web no hace nada). */
export const tacto = {
  toque: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  seleccion: () => void Haptics.selectionAsync().catch(() => {}),
  exito: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  aviso: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
};

type TipoBoton = 'principal' | 'gris' | 'plano' | 'peligro';

/** Botón en forma de cápsula. `principal` es la acción más importante de la pantalla (solo una). */
export function Boton({
  titulo,
  onPress,
  tipo = 'principal',
  icono,
  cargando = false,
  deshabilitado = false,
  pequeno = false,
  estilo,
}: {
  titulo: string;
  onPress: () => void;
  tipo?: TipoBoton;
  icono?: NombreIcono;
  cargando?: boolean;
  deshabilitado?: boolean;
  pequeno?: boolean;
  estilo?: StyleProp<ViewStyle>;
}) {
  const inactivo = deshabilitado || cargando;
  const colorTexto = tipo === 'principal' ? '#FFFFFF' : tipo === 'peligro' ? tema.peligro : tema.acento;
  return (
    <Pressable
      onPress={() => {
        tacto.toque();
        onPress();
      }}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      style={({ pressed }) => [
        s.boton,
        pequeno && s.botonPequeno,
        tipo === 'principal' && { backgroundColor: tema.acento },
        (tipo === 'gris' || tipo === 'peligro') && { backgroundColor: tema.gris },
        tipo === 'plano' && { paddingHorizontal: 8 },
        inactivo && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
        estilo,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={colorTexto} />
      ) : (
        <>
          {icono && <Icono nombre={icono} tamano={pequeno ? 15 : 18} color={colorTexto} peso="semibold" />}
          <Text style={[pequeno ? letra.subtitulo : letra.destacado, { color: colorTexto, fontWeight: '600' }]} numberOfLines={1}>
            {titulo}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Botón redondo con solo un ícono (mínimo 44 pt para el dedo). */
export function BotonIcono({
  icono,
  etiqueta,
  onPress,
  deshabilitado,
  activo,
  tamano = 44,
  color,
  fondo,
}: {
  icono: NombreIcono;
  etiqueta: string;
  onPress: () => void;
  deshabilitado?: boolean;
  activo?: boolean;
  tamano?: number;
  color?: ColorValue;
  fondo?: ColorValue;
}) {
  return (
    <Pressable
      onPress={() => {
        tacto.toque();
        onPress();
      }}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ disabled: deshabilitado, selected: activo }}
      hitSlop={Math.max(0, (44 - tamano) / 2)}
      style={({ pressed }) => [
        s.botonIcono,
        { width: tamano, height: tamano, borderRadius: tamano / 2, backgroundColor: fondo ?? (activo ? tema.acento : tema.gris) },
        deshabilitado && { opacity: 0.35 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Icono nombre={icono} tamano={tamano * 0.42} color={color ?? (activo ? '#FFFFFF' : tema.texto)} peso="semibold" />
    </Pressable>
  );
}

/** Botón de acción con ícono arriba y texto abajo, para barras de herramientas del editor. */
export function Accion({
  icono,
  titulo,
  onPress,
  deshabilitado,
  peligro,
}: {
  icono: NombreIcono;
  titulo: string;
  onPress: () => void;
  deshabilitado?: boolean;
  peligro?: boolean;
}) {
  const color = peligro ? tema.peligro : tema.texto;
  return (
    <Pressable
      onPress={() => {
        tacto.toque();
        onPress();
      }}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => [s.accion, deshabilitado && { opacity: 0.3 }, pressed && { opacity: 0.5 }]}
    >
      <Icono nombre={icono} tamano={22} color={color} />
      <Text style={[letra.leyenda2, { color, fontWeight: '500' }]} numberOfLines={1}>
        {titulo}
      </Text>
    </Pressable>
  );
}

/** Control segmentado nativo de iOS (UISegmentedControl). */
export function Segmentado<T extends string | number | null>({
  opciones,
  valor,
  onCambio,
  estilo,
}: {
  opciones: readonly (readonly [T, string])[];
  valor: T;
  onCambio: (v: T) => void;
  estilo?: StyleProp<ViewStyle>;
}) {
  const indice = opciones.findIndex(([v]) => v === valor);
  return (
    <SegmentedControl
      values={opciones.map(([, t]) => t)}
      selectedIndex={indice}
      appearance="dark"
      onChange={(e) => {
        const o = opciones[e.nativeEvent.selectedSegmentIndex];
        if (o) {
          tacto.seleccion();
          onCambio(o[0]);
        }
      }}
      style={[{ height: 32 }, estilo]}
    />
  );
}

/** Sección de una lista agrupada, como en Ajustes del iPhone. */
export function Grupo({ titulo, pie, children, estilo }: { titulo?: string; pie?: ReactNode; children: ReactNode; estilo?: StyleProp<ViewStyle> }) {
  const hijos = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[s.grupo, estilo]}>
      {titulo && <Text style={s.grupoTitulo}>{titulo}</Text>}
      {hijos.length > 0 && (
        <View style={s.grupoCaja}>
          {hijos.map((h, i) => (
            <Fragment key={h.key ?? i}>
              {i > 0 && <View style={s.separador} />}
              {h}
            </Fragment>
          ))}
        </View>
      )}
      {typeof pie === 'string' ? <Text style={s.grupoPie}>{pie}</Text> : pie}
    </View>
  );
}

/** Fila de una lista agrupada. */
export function Celda({
  titulo,
  subtitulo,
  valor,
  icono,
  colorIcono = tema.acento,
  accesorio,
  onPress,
  destructivo,
  accion,
  deshabilitado,
}: {
  titulo: string;
  subtitulo?: string;
  valor?: string;
  icono?: NombreIcono;
  colorIcono?: ColorValue;
  accesorio?: 'flecha' | 'check' | ReactNode;
  onPress?: () => void;
  destructivo?: boolean;
  /** Fila que hace algo (texto azul), como "Elegir canción". */
  accion?: boolean;
  deshabilitado?: boolean;
}) {
  const contenido = (
    <>
      {icono && (
        <View style={[s.celdaIcono, { backgroundColor: colorIcono }]}>
          <Icono nombre={icono} tamano={17} color="#FFFFFF" />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[letra.cuerpo, { color: destructivo ? tema.peligro : accion ? tema.acento : tema.texto }]} numberOfLines={1}>
          {titulo}
        </Text>
        {subtitulo ? (
          <Text style={[letra.nota, { color: tema.suave }]} numberOfLines={2}>
            {subtitulo}
          </Text>
        ) : null}
      </View>
      {valor ? (
        <Text style={[letra.cuerpo, { color: tema.suave, maxWidth: '50%' }]} numberOfLines={1}>
          {valor}
        </Text>
      ) : null}
      {accesorio === 'flecha' ? (
        <Icono nombre="flecha" tamano={13} color={tema.tenue} peso="semibold" />
      ) : accesorio === 'check' ? (
        <Icono nombre="check" tamano={16} color={tema.acento} peso="semibold" />
      ) : (
        accesorio
      )}
    </>
  );
  if (!onPress) return <View style={s.celda}>{contenido}</View>;
  return (
    <Pressable
      onPress={() => {
        tacto.seleccion();
        onPress();
      }}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado, selected: accesorio === 'check' }}
      style={({ pressed }) => [s.celda, pressed && { backgroundColor: tema.relleno }, deshabilitado && { opacity: 0.4 }]}
    >
      {contenido}
    </Pressable>
  );
}

export function CeldaInterruptor({
  titulo,
  subtitulo,
  icono,
  colorIcono,
  valor,
  onCambio,
}: {
  titulo: string;
  subtitulo?: string;
  icono?: NombreIcono;
  colorIcono?: ColorValue;
  valor: boolean;
  onCambio: (v: boolean) => void;
}) {
  return (
    <Celda
      titulo={titulo}
      subtitulo={subtitulo}
      icono={icono}
      colorIcono={colorIcono}
      accesorio={
        <Switch
          value={valor}
          onValueChange={(v) => {
            tacto.seleccion();
            onCambio(v);
          }}
          accessibilityLabel={titulo}
        />
      }
    />
  );
}

/** Pantalla vacía, como ContentUnavailableView de Apple: ícono, título, explicación y acción. */
export function Vacio({ icono, titulo, texto, children }: { icono: NombreIcono; titulo: string; texto: string; children?: ReactNode }) {
  return (
    <View style={s.vacio}>
      <Icono nombre={icono} tamano={52} color={tema.suave} />
      <Text style={[letra.titulo2, { color: tema.texto, textAlign: 'center' }]}>{titulo}</Text>
      <Text style={[letra.subtitulo, { color: tema.suave, textAlign: 'center', lineHeight: 21 }]}>{texto}</Text>
      {children}
    </View>
  );
}

/** Aviso dentro de la pantalla (en vez de una alerta que interrumpe). */
export function Aviso({ texto, icono = 'aviso', color = tema.seleccion }: { texto: string; icono?: NombreIcono; color?: ColorValue }) {
  return (
    <View style={s.aviso}>
      <Icono nombre={icono} tamano={17} color={color} />
      <Text style={[letra.nota, { color: tema.suave, flex: 1, lineHeight: 18 }]}>{texto}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  boton: {
    minHeight: 50,
    borderRadius: 25,
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonPequeno: { minHeight: 34, borderRadius: 17, paddingHorizontal: 14, gap: 6 },
  botonIcono: { alignItems: 'center', justifyContent: 'center' },
  accion: { minWidth: 56, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  grupo: { marginTop: 24 },
  grupoTitulo: { ...letra.nota, color: tema.suave, textTransform: 'uppercase', marginHorizontal: 16, marginBottom: 7 },
  grupoCaja: { backgroundColor: tema.tarjeta, borderRadius: 12, overflow: 'hidden' },
  grupoPie: { ...letra.nota, color: tema.suave, marginHorizontal: 16, marginTop: 7, lineHeight: 18 },
  separador: { height: StyleSheet.hairlineWidth, backgroundColor: tema.separador, marginLeft: 16 },
  celda: { minHeight: 46, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  celdaIcono: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  vacio: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingVertical: 48 },
  aviso: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: tema.tarjeta, borderRadius: 12, padding: 12 },
});
