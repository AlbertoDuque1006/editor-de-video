import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Boton, Chip, Etiqueta, Fila } from '@/componentes/ui';
import { borrarProyecto, copiarAlProyecto, guardarProyecto, uriDe } from '@/lib/almacen';
import { leerClave } from '@/lib/ajustes';
import { tema } from '@/lib/estilos';
import { crearBorrador } from '@/lib/ia';
import { medirVideo } from '@/lib/medios';
import { hayNativo, transcribirClip } from '@/lib/nativo';
import { FORMATOS, aplicarPlan, formatoTiempo, nuevoId, tramosCompletos } from '@/lib/proyecto';
import type { Clip, Formato, Proyecto } from '@/lib/tipos';

const DURACIONES: [number | null, string][] = [
  [15, '15 s'],
  [30, '30 s'],
  [60, '1 min'],
  [null, 'Libre'],
];

const extension = (nombre: string | null | undefined, uri: string, porDefecto: string) =>
  (nombre ?? uri).split('?')[0].split('.').pop()?.toLowerCase() || porDefecto;

export default function Nuevo() {
  const [videos, setVideos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [musica, setMusica] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [nombre, setNombre] = useState('');
  const [pedido, setPedido] = useState('');
  const [formato, setFormato] = useState<Formato>('9:16');
  const [duracion, setDuracion] = useState<number | null>(30);
  const [paso, setPaso] = useState<string | null>(null);

  const elegirVideos = async () => {
    await ImagePicker.requestMediaLibraryPermissionsAsync();
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      orderedSelection: true,
    });
    if (!r.canceled) setVideos(r.assets);
  };

  const elegirMusica = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!r.canceled) setMusica(r.assets[0]);
  };

  const crear = async (conIA: boolean) => {
    if (videos.length === 0) return Alert.alert('Elige al menos un video');
    if (conIA && !(await leerClave())) {
      return Alert.alert('Falta la clave de Claude', 'Ponla en Ajustes para que la IA arme el video.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ir a Ajustes', onPress: () => router.push('/ajustes') },
      ]);
    }
    await activateKeepAwakeAsync();
    const id = nuevoId();
    try {
      setPaso('Copiando los clips…');
      const clips: Clip[] = [];
      for (const [i, v] of videos.entries()) {
        const archivo = `clip-${i + 1}.${extension(v.fileName, v.uri, 'mov')}`;
        await copiarAlProyecto(id, v.uri, archivo);
        let { duration, width, height } = v;
        let dur = duration ? duration / 1000 : 0;
        if (!dur || !width) {
          const m = await medirVideo(uriDe(id, archivo));
          dur = m.duracion;
          width = m.ancho;
          height = m.alto;
        }
        clips.push({
          id: nuevoId(),
          archivo,
          nombre: v.fileName ?? `Clip ${i + 1}`,
          duracion: dur,
          ancho: width,
          alto: height,
          transcripcion: null,
          descripcion: '',
        });
      }
      let musicaProyecto: Proyecto['musica'] = null;
      if (musica) {
        const archivo = `musica.${extension(musica.name, musica.uri, 'm4a')}`;
        await copiarAlProyecto(id, musica.uri, archivo);
        musicaProyecto = { archivo, nombre: musica.name, volumen: 0.35 };
      }

      let p: Proyecto = {
        id,
        nombre: nombre.trim() || `Video ${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`,
        creado: Date.now(),
        editado: Date.now(),
        formato,
        pedido: pedido.trim(),
        duracionDeseada: duracion,
        clips,
        tramos: tramosCompletos(clips),
        textos: [],
        subtitulos: false,
        musica: musicaProyecto,
        volumenOriginal: 1,
        publicacion: null,
        chat: [],
      };
      await guardarProyecto(p);

      if (hayNativo) {
        for (const [i, c] of p.clips.entries()) {
          setPaso(`Escuchando lo que se dice (${i + 1} de ${p.clips.length})…`);
          c.transcripcion = await transcribirClip(id, c).catch(() => null);
        }
        await guardarProyecto(p);
      }

      if (conIA) {
        setPaso('Claude está mirando los clips y armando el video…');
        try {
          const plan = await crearBorrador(p);
          p = aplicarPlan(p, plan);
          p.chat = [{ de: 'ia', texto: plan.mensaje }];
        } catch (e) {
          p.chat = [{ de: 'ia', texto: `No pude armar el borrador: ${e instanceof Error ? e.message : e}. Puedes pedírmelo de nuevo en el chat.` }];
        }
        await guardarProyecto(p);
      }
      router.replace(`/editor/${id}`);
    } catch (e) {
      borrarProyecto(id);
      Alert.alert('No se pudo crear el video', e instanceof Error ? e.message : String(e));
    } finally {
      deactivateKeepAwake();
      setPaso(null);
    }
  };

  if (paso) {
    return (
      <View style={s.esperando}>
        <Text style={s.pasoTexto}>{paso}</Text>
        <Text style={s.nota}>No cierres la app.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tema.fondo }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Etiqueta>1. Tus clips</Etiqueta>
      <Boton titulo={videos.length ? `${videos.length} clips elegidos · cambiar` : 'Elegir videos de la galería'} tipo="secundario" onPress={elegirVideos} />
      {videos.length > 0 && (
        <Text style={s.nota}>
          {videos.map((v, i) => `${i + 1}. ${v.fileName ?? 'Video'}${v.duration ? ` (${formatoTiempo(v.duration / 1000)})` : ''}`).join('\n')}
        </Text>
      )}

      <Etiqueta>2. ¿Qué video quieres?</Etiqueta>
      <TextInput
        value={pedido}
        onChangeText={setPedido}
        placeholder="Ej: Reel para promocionar el corte de pelo de $25.000, con tono alegre y un llamado a reservar por WhatsApp."
        placeholderTextColor={tema.suave}
        multiline
        style={[s.input, { minHeight: 96, textAlignVertical: 'top' }]}
      />

      <Etiqueta>Formato</Etiqueta>
      <Fila>
        {(Object.keys(FORMATOS) as Formato[]).map((f) => (
          <Chip key={f} texto={`${FORMATOS[f].nombre} ${f}`} activo={formato === f} onPress={() => setFormato(f)} />
        ))}
      </Fila>
      <Text style={s.nota}>{FORMATOS[formato].uso}</Text>

      <Etiqueta>Duración</Etiqueta>
      <Fila>
        {DURACIONES.map(([d, t]) => (
          <Chip key={t} texto={t} activo={duracion === d} onPress={() => setDuracion(d)} />
        ))}
      </Fila>

      <Etiqueta>Música (opcional)</Etiqueta>
      <Fila>
        <Boton titulo={musica ? musica.name : 'Elegir canción de Archivos'} tipo="secundario" onPress={elegirMusica} estilo={{ flex: 1 }} />
        {musica && <Chip texto="Quitar" activo={false} onPress={() => setMusica(null)} />}
      </Fila>

      <Etiqueta>Nombre (opcional)</Etiqueta>
      <TextInput value={nombre} onChangeText={setNombre} placeholder="Promo diciembre" placeholderTextColor={tema.suave} style={s.input} />

      <Boton titulo="✨ Crear con IA" onPress={() => crear(true)} estilo={{ marginTop: 28 }} deshabilitado={!videos.length} />
      <Boton titulo="Crear sin IA (solo unir los clips)" tipo="secundario" onPress={() => crear(false)} estilo={{ marginTop: 10 }} deshabilitado={!videos.length} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: tema.tarjeta, color: tema.texto, borderRadius: 12, padding: 14, fontSize: 16, borderWidth: 1, borderColor: tema.borde },
  nota: { color: tema.suave, fontSize: 13, lineHeight: 19, marginTop: 8 },
  esperando: { flex: 1, backgroundColor: tema.fondo, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  pasoTexto: { color: tema.texto, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
