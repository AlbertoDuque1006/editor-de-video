import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icono, sf } from '@/componentes/Icono';
import { letra, tema } from '@/componentes/tema';
import { Aviso, Boton, Vacio, tacto } from '@/componentes/ui';
import { borrarProyecto, duplicarProyecto, guardarProyecto, listarProyectos, portadaDe } from '@/lib/almacen';
import { FORMATOS, duracionTotal, formatoTiempo, nuevoId } from '@/lib/proyecto';
import { hayNativo } from '@/lib/nativo';
import type { Proyecto } from '@/lib/tipos';

/** "Hoy", "Ayer" o la fecha corta. */
function cuando(ms: number): string {
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(new Date(ms))) / 86400000);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return new Date(ms).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

const ICONO_FORMATO = { '9:16': 'vertical', '1:1': 'cuadrado', '16:9': 'horizontal' } as const;

export default function Inicio() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const anchoTarjeta = (width - 16 * 2 - 12) / 2;

  const recargar = useCallback(() => setProyectos(listarProyectos()), []);
  useFocusEffect(recargar);

  const borrar = (p: Proyecto) => {
    tacto.aviso();
    Alert.alert('¿Borrar este video?', `"${p.nombre}" y sus clips se borran del iPhone. Lo que exportaste a Fotos no se toca.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          borrarProyecto(p.id);
          recargar();
        },
      },
    ]);
  };

  const renombrar = (p: Proyecto) =>
    Alert.prompt(
      'Cambiar el nombre',
      undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar',
          isPreferred: true,
          onPress: async (nombre?: string) => {
            if (!nombre?.trim()) return;
            await guardarProyecto({ ...p, nombre: nombre.trim(), editado: Date.now() });
            recargar();
          },
        },
      ],
      'plain-text',
      p.nombre,
    );

  const duplicar = async (p: Proyecto) => {
    await duplicarProyecto(p, nuevoId(), `${p.nombre} (copia)`);
    tacto.exito();
    recargar();
  };

  return (
    <View style={s.pantalla}>
      <FlatList
        data={proyectos}
        keyExtractor={(p) => p.id}
        numColumns={2}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 120 + insets.bottom }}
        columnWrapperStyle={{ gap: 12 }}
        ListHeaderComponent={hayNativo ? undefined : <Aviso texto="Estás en Expo Go: puedes crear y editar con IA, pero exportar y los subtítulos automáticos necesitan la app instalada." />}
        ListEmptyComponent={
          <Vacio icono="videos" titulo="Aún no hay videos" texto="Elige tus clips, cuéntale a Claude qué video quieres y él arma el borrador: cortes, textos y subtítulos." />
        }
        renderItem={({ item: p }) => {
          const portada = portadaDe(p.id);
          return (
            <Link href={{ pathname: '/editor/[id]', params: { id: p.id } }} asChild>
              <Link.Trigger>
                <Pressable style={{ width: anchoTarjeta, borderRadius: 14 }} accessibilityLabel={`${p.nombre}, ${formatoTiempo(duracionTotal(p))}`}>
                  <View style={[s.portada, { height: anchoTarjeta * 1.25 }]}>
                    {portada ? (
                      <Image source={{ uri: portada }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" />
                    ) : (
                      <Icono nombre="video" tamano={34} color={tema.tenue} />
                    )}
                    <View style={s.insignia}>
                      <Icono nombre={ICONO_FORMATO[p.formato]} tamano={11} color="#FFFFFF" />
                      <Text style={s.insigniaTexto}>{formatoTiempo(duracionTotal(p)).replace(/\.\d$/, '')}</Text>
                    </View>
                  </View>
                  <Text style={[letra.subtitulo, s.nombre]} numberOfLines={1}>
                    {p.nombre}
                  </Text>
                  <Text style={[letra.nota, { color: tema.suave }]} numberOfLines={1}>
                    {cuando(p.editado)} · {FORMATOS[p.formato].nombre}
                  </Text>
                </Pressable>
              </Link.Trigger>
              <Link.Menu>
                <Link.MenuAction icon={sf('lapiz')} onPress={() => renombrar(p)}>
                  Cambiar el nombre
                </Link.MenuAction>
                <Link.MenuAction icon={sf('duplicar')} onPress={() => duplicar(p)}>
                  Duplicar
                </Link.MenuAction>
                <Link.MenuAction icon={sf('basura')} destructive onPress={() => borrar(p)}>
                  Borrar
                </Link.MenuAction>
              </Link.Menu>
            </Link>
          );
        }}
      />

      <View style={[s.abajo, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <Boton titulo="Nuevo video con IA" icono="ia" onPress={() => router.push('/nuevo')} estilo={s.botonNuevo} />
      </View>

      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={sf('ajustes')} accessibilityLabel="Ajustes" onPress={() => router.push('/ajustes')} />
      </Stack.Toolbar>
    </View>
  );
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: tema.fondo },
  portada: { borderRadius: 14, backgroundColor: tema.tarjeta, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  insignia: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  insigniaTexto: { ...letra.leyenda, color: '#FFFFFF', fontWeight: '600', fontVariant: ['tabular-nums'] },
  nombre: { color: tema.texto, fontWeight: '600', marginTop: 8 },
  abajo: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  botonNuevo: {
    paddingHorizontal: 28,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
});
