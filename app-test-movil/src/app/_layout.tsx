import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { temaFijo } from '@/componentes/tema';

// El tema oscuro de la navegación con los colores de iOS. Sin esto, los botones de cristal
// (Liquid Glass, iOS 26) parpadean al cambiar de pantalla.
const temaNavegacion = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: temaFijo.acento,
    background: temaFijo.fondo,
    card: temaFijo.fondo,
    text: temaFijo.texto,
    border: temaFijo.separador,
  },
};

export default function Layout() {
  return (
    <ThemeProvider value={temaNavegacion}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerTintColor: temaFijo.acento,
          headerTitleStyle: { color: temaFijo.texto },
          headerLargeTitleStyle: { color: temaFijo.texto },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: temaFijo.fondo },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Mis videos', headerLargeTitleEnabled: true }} />
        <Stack.Screen name="nuevo" options={{ title: 'Nuevo video', presentation: 'modal' }} />
        <Stack.Screen name="ajustes" options={{ title: 'Ajustes', presentation: 'modal' }} />
        <Stack.Screen name="editor/[id]" options={{ title: '', headerStyle: { backgroundColor: temaFijo.fondo } }} />
      </Stack>
    </ThemeProvider>
  );
}
