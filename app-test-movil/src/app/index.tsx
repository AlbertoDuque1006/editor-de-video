import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { Boton } from '@/componentes/ui';
import { borrarProyecto, listarProyectos } from '@/lib/almacen';
import { tema } from '@/lib/estilos';
import { FORMATOS, duracionTotal, formatoTiempo } from '@/lib/proyecto';
import { hayNativo } from '@/lib/nativo';
import type { Proyecto } from '@/lib/tipos';

export default function Inicio() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);

  useFocusEffect(
    useCallback(() => {
      setProyectos(listarProyectos());
    }, []),
  );

  const borrar = (p: Proyecto) =>
    Alert.alert('¿Borrar este video?', `"${p.nombre}" y sus clips se borran del iPhone. Lo que exportaste a Fotos no se toca.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          borrarProyecto(p.id);
          setProyectos(listarProyectos());
        },
      },
    ]);

  return (
    <View style={s.pantalla}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/ajustes" asChild>
              <Pressable hitSlop={10}>
                <Text style={{ color: tema.texto, fontSize: 16 }}>Ajustes</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        data={proyectos}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 8 }}>
            <Boton titulo="+  Nuevo video con IA" onPress={() => router.push('/nuevo')} />
            {!hayNativo && (
              <Text style={s.aviso}>
                Estás en Expo Go: puedes crear y editar con IA, pero exportar y los subtítulos automáticos necesitan la app
                instalada.
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={<Text style={s.vacio}>Aún no tienes videos. Crea el primero con el botón de arriba.</Text>}
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => router.push(`/editor/${p.id}`)}
            onLongPress={() => borrar(p)}
            style={({ pressed }) => [s.tarjeta, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.nombre} numberOfLines={1}>
              {p.nombre}
            </Text>
            <Text style={s.detalle}>
              {FORMATOS[p.formato].nombre} · {formatoTiempo(duracionTotal(p))} · {p.clips.length} clips ·{' '}
              {new Date(p.editado).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={proyectos.length > 0 ? <Text style={s.pista}>Mantén presionado un video para borrarlo.</Text> : undefined}
      />
    </View>
  );
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: tema.fondo },
  tarjeta: { backgroundColor: tema.tarjeta, borderRadius: 14, padding: 16, gap: 4 },
  nombre: { color: tema.texto, fontSize: 17, fontWeight: '700' },
  detalle: { color: tema.suave, fontSize: 14 },
  vacio: { color: tema.suave, textAlign: 'center', marginTop: 40, fontSize: 15 },
  aviso: { color: '#FFD60A', fontSize: 13, lineHeight: 18 },
  pista: { color: tema.suave, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
