import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import { Icono } from '@/componentes/Icono';
import { letra, tema } from '@/componentes/tema';
import { Celda, Grupo, tacto } from '@/componentes/ui';
import { guardarClave, guardarIdioma, leerClave, leerIdioma } from '@/lib/ajustes';
import { probarClave } from '@/lib/ia';

const IDIOMAS = [
  ['es-CO', 'Español (Colombia)'],
  ['es-MX', 'Español (México)'],
  ['es-ES', 'Español (España)'],
  ['en-US', 'Inglés'],
] as const;

export default function Ajustes() {
  const [clave, setClave] = useState('');
  const [idioma, setIdioma] = useState('es-CO');
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    leerClave().then((c) => setClave(c ?? ''));
    leerIdioma().then(setIdioma);
  }, []);

  const guardar = async () => {
    setProbando(true);
    try {
      if (clave.trim()) await probarClave(clave.trim());
      await guardarClave(clave);
      await guardarIdioma(idioma);
      tacto.exito();
      router.back();
    } catch (e) {
      tacto.aviso();
      Alert.alert('La clave no funcionó', e instanceof Error ? e.message : String(e));
    } finally {
      setProbando(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: tema.fondo }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancelar</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={probando} onPress={guardar}>
          {probando ? 'Probando…' : 'Guardar'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <Grupo
        titulo="Clave de Claude"
        pie="Se crea en console.anthropic.com → API Keys y queda guardada solo en el llavero de este iPhone. Claude se cobra por uso a esa cuenta: un borrador con fotos cuesta del orden de 5 a 15 centavos de dólar y cada cambio por chat, unos pocos centavos."
      >
        <View style={s.fila}>
          <Icono nombre="llave" tamano={18} color={tema.suave} />
          <TextInput
            value={clave}
            onChangeText={setClave}
            placeholder="sk-ant-…"
            placeholderTextColor={tema.tenue}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={guardar}
            style={[letra.cuerpo, s.campo]}
            accessibilityLabel="Clave de Claude"
          />
        </View>
      </Grupo>

      <Grupo titulo="Idioma de los subtítulos" pie="En este idioma escucha el iPhone lo que se dice en tus clips.">
        {IDIOMAS.map(([id, nombre]) => (
          <Celda key={id} titulo={nombre} accesorio={idioma === id ? 'check' : undefined} onPress={() => setIdioma(id)} />
        ))}
      </Grupo>

      <Grupo titulo="Acerca de">
        <Celda titulo="Versión" valor={Constants.expoConfig?.version ?? '—'} />
        <Celda titulo="Modelo de IA" valor="Claude Opus 5.5" />
      </Grupo>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 46 },
  campo: { flex: 1, color: tema.texto, paddingVertical: 12 },
});
