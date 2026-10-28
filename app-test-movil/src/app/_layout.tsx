import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { tema } from '@/lib/estilos';

export default function Layout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: tema.fondo },
          headerTintColor: tema.texto,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: tema.fondo },
          headerBackTitle: 'Atrás',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Mis videos' }} />
        <Stack.Screen name="nuevo" options={{ title: 'Nuevo video' }} />
        <Stack.Screen name="ajustes" options={{ title: 'Ajustes', presentation: 'modal' }} />
        <Stack.Screen name="editor/[id]" options={{ title: '' }} />
      </Stack>
    </>
  );
}
