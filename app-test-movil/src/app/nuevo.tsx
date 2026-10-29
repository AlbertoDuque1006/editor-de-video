import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { VideoThumbnail } from 'expo-video';
import { Icono } from '@/componentes/Icono';
import { letra, tema } from '@/componentes/tema';
import { Boton, Celda, Grupo, Segmentado, tacto } from '@/componentes/ui';
import { borrarProyecto, copiarAlProyecto, guardarProyecto, uriDe } from '@/lib/almacen';
import { leerClave } from '@/lib/ajustes';
import { crearBorrador } from '@/lib/ia';
import { fotogramas, guardarPortada, medirVideo } from '@/lib/medios';
import { hayNativo, transcribirClip } from '@/lib/nativo';
import { FORMATOS, aplicarPlan, formatoTiempo, nuevoId, tramosCompletos } from '@/lib/proyecto';
import type { Clip, Formato, Proyecto } from '@/lib/tipos';

const DURACIONES = [
  [15, '15 s'],
  [30, '30 s'],
  [60, '1 min'],
  [null, 'Libre'],
] as const;

const FORMATOS_OPCIONES = (Object.keys(FORMATOS) as Formato[]).map((f) => [f, FORMATOS[f].nombre] as const);

/** Ideas para empezar el pedido: se agregan al texto con un toque. */
const IDEAS = [
  ['Promoción', 'Promoción con el precio en grande y un llamado a reservar por WhatsApp'],
  ['Antes y después', 'Antes y después, con música alegre'],
  ['Tutorial', 'Tutorial paso a paso con un texto en cada paso'],
  ['Testimonio', 'Testimonio de un cliente con subtítulos'],
  ['Presentar el negocio', 'Presentación del negocio, corta y dinámica'],
] as const;

const extension = (nombre: string | null | undefined, uri: string, porDefecto: string) =>
  (nombre ?? uri).split('?')[0].split('.').pop()?.toLowerCase() || porDefecto;

interface Progreso {
  pasos: string[];
  actual: number;
  detalle: string;
}

export default function Nuevo() {
  const insets = useSafeAreaInsets();
  const [videos, setVideos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [fotos, setFotos] = useState<Record<string, VideoThumbnail>>({});
  const [musica, setMusica] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [nombre, setNombre] = useState('');
  const [pedido, setPedido] = useState('');
  const [formato, setFormato] = useState<Formato>('9:16');
  const [duracion, setDuracion] = useState<number | null>(30);
  const [progreso, setProgreso] = useState<Progreso | null>(null);

  // Una foto de cada clip elegido.
  useEffect(() => {
    let vivo = true;
    (async () => {
      for (const v of videos) {
        if (fotos[v.uri]) continue;
        const [f] = await fotogramas(v.uri, [Math.min(0.5, (v.duration ?? 1000) / 2000)], 240).catch(() => []);
        if (!vivo) return;
        if (f) setFotos((x) => ({ ...x, [v.uri]: f }));
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos]);

  const elegirVideos = async () => {
    await ImagePicker.requestMediaLibraryPermissionsAsync();
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      orderedSelection: true,
    });
    if (!r.canceled) {
      // Los que ya estaban se quedan; los nuevos van al final.
      setVideos((antes) => [...antes, ...r.assets.filter((a) => !antes.some((b) => b.assetId && b.assetId === a.assetId))]);
    }
  };

  const elegirMusica = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!r.canceled) setMusica(r.assets[0]);
  };

  const agregarIdea = (idea: string) => setPedido((p) => (p.trim() ? `${p.trim()}. ${idea}` : idea));

  const crear = async (conIA: boolean) => {
    if (videos.length === 0) return;
    if (conIA && !(await leerClave())) {
      return Alert.alert('Falta la clave de Claude', 'Ponla en Ajustes para que la IA arme el video.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ir a Ajustes', isPreferred: true, onPress: () => router.push('/ajustes') },
      ]);
    }
    const pasos = ['Copiar los clips', ...(hayNativo ? ['Escuchar lo que se dice'] : []), ...(conIA ? ['Claude arma el video'] : [])];
    const ir = (actual: number, detalle = '') => setProgreso({ pasos, actual, detalle });
    await activateKeepAwakeAsync();
    const id = nuevoId();
    try {
      ir(0);
      const clips: Clip[] = [];
      for (const [i, v] of videos.entries()) {
        ir(0, `${i + 1} de ${videos.length}`);
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
          ir(1, `${i + 1} de ${p.clips.length}`);
          c.transcripcion = await transcribirClip(id, c).catch(() => null);
        }
        await guardarProyecto(p);
      }

      if (conIA) {
        ir(pasos.length - 1, 'Mira fotos de cada clip y escribe los textos. Puede tardar un minuto.');
        try {
          const plan = await crearBorrador(p);
          p = aplicarPlan(p, plan);
          p.chat = [{ de: 'ia', texto: plan.mensaje }];
        } catch (e) {
          p.chat = [{ de: 'ia', texto: `No pude armar el borrador: ${e instanceof Error ? e.message : e}. Puedes pedírmelo de nuevo en el chat.` }];
        }
        await guardarProyecto(p);
      }
      const primero = p.clips.find((c) => c.id === p.tramos[0]?.clipId);
      if (primero) await guardarPortada(id, uriDe(id, primero.archivo), p.tramos[0].inicio + 0.3).catch(() => {});
      tacto.exito();
      router.replace({ pathname: '/editor/[id]', params: { id } });
    } catch (e) {
      borrarProyecto(id);
      tacto.aviso();
      Alert.alert('No se pudo crear el video', e instanceof Error ? e.message : String(e));
    } finally {
      deactivateKeepAwake();
      setProgreso(null);
    }
  };

  if (progreso) {
    return (
      <View style={s.esperando}>
        <Stack.Screen options={{ gestureEnabled: false, title: 'Creando el video' }} />
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button hidden onPress={() => {}} />
        </Stack.Toolbar>
        <View style={s.pasos}>
          {progreso.pasos.map((paso, i) => {
            const hecho = i < progreso.actual;
            const ahora = i === progreso.actual;
            return (
              <View key={paso} style={s.paso}>
                <View style={s.pasoIcono}>
                  {hecho ? (
                    <Icono nombre="checkCirculo" tamano={24} color={tema.ok} />
                  ) : ahora ? (
                    <ActivityIndicator color={tema.acento} />
                  ) : (
                    <Icono nombre="circulo" tamano={22} color={tema.tenue} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[letra.destacado, { color: hecho || ahora ? tema.texto : tema.tenue }]}>{paso}</Text>
                  {ahora && progreso.detalle ? <Text style={[letra.nota, { color: tema.suave }]}>{progreso.detalle}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
        <Text style={[letra.nota, { color: tema.suave, textAlign: 'center' }]}>No cierres la app mientras tanto.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tema.fondo }}>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancelar</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 170 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Grupo
          titulo="Tus clips"
          pie={videos.length ? 'Van en este orden. Toca la × para quitar uno.' : 'Elige uno o varios videos de tu galería, en el orden en que quieres que salgan.'}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.clips}>
            {videos.map((v, i) => (
              <View key={v.uri} style={s.clip}>
                {fotos[v.uri] ? (
                  <Image source={fotos[v.uri]} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Icono nombre="video" tamano={22} color={tema.tenue} />
                )}
                <Text style={s.clipNumero}>{i + 1}</Text>
                {v.duration ? <Text style={s.clipDuracion}>{formatoTiempo(v.duration / 1000).replace(/\.\d$/, '')}</Text> : null}
                <Pressable
                  onPress={() => {
                    tacto.toque();
                    setVideos((x) => x.filter((y) => y.uri !== v.uri));
                  }}
                  hitSlop={10}
                  accessibilityLabel={`Quitar el clip ${i + 1}`}
                  style={s.clipQuitar}
                >
                  <Icono nombre="cerrar" tamano={10} color="#FFFFFF" peso="bold" />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={elegirVideos}
              accessibilityRole="button"
              accessibilityLabel={videos.length ? 'Agregar más clips' : 'Elegir videos de la galería'}
              style={({ pressed }) => [s.clip, s.clipAgregar, videos.length === 0 && { width: 150 }, pressed && { opacity: 0.6 }]}
            >
              <Icono nombre="galeria" tamano={26} color={tema.acento} />
              <Text style={[letra.nota, { color: tema.acento, fontWeight: '600', textAlign: 'center' }]}>
                {videos.length ? 'Agregar' : 'Elegir videos'}
              </Text>
            </Pressable>
          </ScrollView>
        </Grupo>

        <Grupo titulo="¿Qué video quieres?" pie="Cuéntalo con tus palabras: qué se promociona, el tono, el precio, el llamado a la acción.">
          <TextInput
            value={pedido}
            onChangeText={setPedido}
            placeholder="Ej: Reel para promocionar el corte de pelo de $25.000, con tono alegre."
            placeholderTextColor={tema.tenue}
            multiline
            style={[letra.cuerpo, s.pedido]}
            accessibilityLabel="Qué video quieres"
          />
        </Grupo>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }} keyboardShouldPersistTaps="handled">
          {IDEAS.map(([corto, idea]) => (
            <Pressable
              key={corto}
              onPress={() => {
                tacto.seleccion();
                agregarIdea(idea);
              }}
              accessibilityHint={idea}
              style={({ pressed }) => [s.idea, pressed && { opacity: 0.6 }]}
            >
              <Icono nombre="mas" tamano={12} color={tema.acento} peso="semibold" />
              <Text style={[letra.subtitulo, { color: tema.texto }]} numberOfLines={1}>
                {corto}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Grupo titulo="Formato" pie={FORMATOS[formato].uso}>
          <View style={s.control}>
            <Segmentado opciones={FORMATOS_OPCIONES} valor={formato} onCambio={setFormato} />
          </View>
        </Grupo>

        <Grupo titulo="Duración">
          <View style={s.control}>
            <Segmentado opciones={DURACIONES} valor={duracion} onCambio={setDuracion} />
          </View>
        </Grupo>

        <Grupo titulo="Más opciones">
          <Celda icono="musica" colorIcono={tema.cursor} titulo="Música" valor={musica ? musica.name : 'Ninguna'} accesorio="flecha" onPress={elegirMusica} />
          {musica && <Celda titulo="Quitar la música" destructivo onPress={() => setMusica(null)} />}
          <View style={s.filaNombre}>
            <View style={[s.iconoCelda, { backgroundColor: tema.naranja }]}>
              <Icono nombre="lapiz" tamano={16} color="#FFFFFF" />
            </View>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              placeholder="Nombre (opcional)"
              placeholderTextColor={tema.tenue}
              style={[letra.cuerpo, { flex: 1, color: tema.texto, paddingVertical: 12 }]}
              returnKeyType="done"
              accessibilityLabel="Nombre del video"
            />
          </View>
        </Grupo>
      </ScrollView>

      <View style={[s.abajo, { paddingBottom: insets.bottom + 8 }]}>
        <Boton titulo="Crear con IA" icono="ia" onPress={() => crear(true)} deshabilitado={!videos.length} />
        <Boton titulo="Solo unir los clips" tipo="plano" onPress={() => crear(false)} deshabilitado={!videos.length} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  clips: { padding: 12, gap: 10 },
  clip: {
    width: 76,
    height: 104,
    borderRadius: 10,
    backgroundColor: tema.relleno,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipAgregar: { gap: 6, borderWidth: 1, borderColor: tema.separador, borderStyle: 'dashed', backgroundColor: 'transparent' },
  clipNumero: {
    position: 'absolute',
    left: 5,
    top: 5,
    ...letra.leyenda2,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    overflow: 'hidden',
    minWidth: 16,
    textAlign: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  clipDuracion: { position: 'absolute', left: 6, bottom: 5, ...letra.leyenda2, fontWeight: '600', color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  clipQuitar: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pedido: { color: tema.texto, minHeight: 110, padding: 16, paddingTop: 14, textAlignVertical: 'top' },
  idea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: tema.tarjeta,
    borderRadius: 17,
    paddingHorizontal: 13,
    minHeight: 34,
  },
  control: { padding: 12 },
  filaNombre: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 46 },
  iconoCelda: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  abajo: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 2,
    backgroundColor: tema.fondo,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tema.separador,
  },
  esperando: { flex: 1, backgroundColor: tema.fondo, justifyContent: 'center', padding: 32, gap: 28 },
  pasos: { gap: 22 },
  paso: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  pasoIcono: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});
