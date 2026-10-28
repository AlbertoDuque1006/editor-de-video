import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Boton, Chip, Etiqueta, Fila } from '@/componentes/ui';
import { guardarClave, guardarIdioma, leerClave, leerIdioma } from '@/lib/ajustes';
import { tema } from '@/lib/estilos';
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
      router.back();
    } catch (e) {
      Alert.alert('La clave no funcionó', e instanceof Error ? e.message : String(e));
    } finally {
      setProbando(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: tema.fondo }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Etiqueta>Clave de Claude</Etiqueta>
      <TextInput
        value={clave}
        onChangeText={setClave}
        placeholder="sk-ant-…"
        placeholderTextColor={tema.suave}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
      <Text style={s.nota}>
        Se crea en console.anthropic.com → API Keys. Queda guardada solo en el llavero de este iPhone. Claude se cobra por uso a esa
        cuenta: un borrador con fotos cuesta del orden de 5 a 15 centavos de dólar y cada cambio por chat, unos pocos centavos.
      </Text>

      <Etiqueta>Idioma de los subtítulos</Etiqueta>
      <Fila>
        {IDIOMAS.map(([id, nombre]) => (
          <Chip key={id} texto={nombre} activo={idioma === id} onPress={() => setIdioma(id)} />
        ))}
      </Fila>

      <Boton titulo="Guardar" onPress={guardar} cargando={probando} estilo={{ marginTop: 28 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: tema.tarjeta, color: tema.texto, borderRadius: 12, padding: 14, fontSize: 16, borderWidth: 1, borderColor: tema.borde },
  nota: { color: tema.suave, fontSize: 13, lineHeight: 18, marginTop: 8 },
});
