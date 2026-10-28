import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Vista, type VistaRef } from '@/componentes/Vista';
import { Boton, Chip, Etiqueta, Fila, Mini } from '@/componentes/ui';
import { copiarAlProyecto, guardarProyecto, leerProyecto } from '@/lib/almacen';
import { COLORES, tema } from '@/lib/estilos';
import { ErrorIA, pedirCambio } from '@/lib/ia';
import { AVISO_EXPO_GO, exportar, hayNativo, transcribirClip } from '@/lib/nativo';
import { FORMATOS, TRAMO_MINIMO, aplicarPlan, duracionTotal, formatoTiempo, nuevoId } from '@/lib/proyecto';
import type { Animacion, Estilo, Formato, Posicion, Proyecto, Texto, Tramo } from '@/lib/tipos';

type Pestana = 'ia' | 'cortes' | 'textos' | 'mas';

const ATAJOS = [
  'Hazlo más corto y dinámico',
  'Pon un título con gancho al inicio',
  'Agrega subtítulos',
  'Quita los silencios y las muletillas',
  'Agrega un llamado a la acción al final',
  'Escribe el texto para publicar',
];

export default function Editor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [p, setP] = useState<Proyecto | null>(() => leerProyecto(id));
  // Copia al día del proyecto: varios cambios seguidos (antes y después de esperar a la IA) se encadenan bien.
  const actual = useRef(p);
  const historial = useRef<Proyecto[]>([]);
  const [pestana, setPestana] = useState<Pestana>('ia');
  const [teclado, setTeclado] = useState(false);
  const vista = useRef<VistaRef>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', () => setTeclado(true));
    const b = Keyboard.addListener('keyboardWillHide', () => setTeclado(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  /** Todo cambio pasa por aquí: se guarda en disco y se puede deshacer. */
  const cambiar = useCallback((f: (actual: Proyecto) => Proyecto) => {
    const antes = actual.current;
    if (!antes) return;
    const nuevo = { ...f(antes), editado: Date.now() };
    historial.current.push(antes);
    if (historial.current.length > 50) historial.current.shift();
    actual.current = nuevo;
    setP(nuevo);
    guardarProyecto(nuevo);
  }, []);

  const deshacer = () => {
    const anterior = historial.current.pop();
    if (!anterior) return;
    actual.current = anterior;
    setP(anterior);
    guardarProyecto(anterior);
  };

  // Exportar
  const [progreso, setProgreso] = useState<number | null>(null);
  const [exportado, setExportado] = useState<string | null>(null);
  const exportarVideo = async () => {
    if (!p) return;
    vista.current?.pausar();
    if (!hayNativo) return Alert.alert('Exportar', AVISO_EXPO_GO);
    setProgreso(0);
    await activateKeepAwakeAsync();
    try {
      const uri = await exportar(p, setProgreso);
      setExportado(uri);
    } catch (e) {
      Alert.alert('No se pudo exportar', e instanceof Error ? e.message : String(e));
    } finally {
      deactivateKeepAwake();
      setProgreso(null);
    }
  };

  if (!p) return <Text style={{ color: tema.texto, padding: 20 }}>No encontré este video.</Text>;

  const altoVista = teclado ? 150 : Math.min(height * 0.42, 420);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: tema.fondo }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen
        options={{
          title: p.nombre,
          headerRight: () => (
            <Fila estilo={{ flexWrap: 'nowrap' }}>
              <Pressable onPress={deshacer} hitSlop={8} disabled={historial.current.length === 0}>
                <Text style={[s.accion, historial.current.length === 0 && { opacity: 0.35 }]}>Deshacer</Text>
              </Pressable>
              <Pressable onPress={exportarVideo} hitSlop={8}>
                <Text style={[s.accion, { color: tema.acento, fontWeight: '800' }]}>Exportar</Text>
              </Pressable>
            </Fila>
          ),
        }}
      />

      <View style={{ paddingTop: 8 }}>
        <Vista ref={vista} proyecto={p} ancho={width - 32} altoMaximo={altoVista} />
      </View>

      <View style={s.pestanas}>
        {(
          [
            ['ia', 'IA'],
            ['cortes', 'Cortes'],
            ['textos', 'Textos'],
            ['mas', 'Más'],
          ] as [Pestana, string][]
        ).map(([k, t]) => (
          <Pressable key={k} onPress={() => setPestana(k)} style={[s.pestana, pestana === k && s.pestanaActiva]}>
            <Text style={[s.pestanaTexto, pestana === k && { color: tema.texto }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {pestana === 'ia' && <PanelIA p={p} cambiar={cambiar} />}
      {pestana === 'cortes' && <PanelCortes p={p} cambiar={cambiar} />}
      {pestana === 'textos' && <PanelTextos p={p} cambiar={cambiar} />}
      {pestana === 'mas' && <PanelMas p={p} cambiar={cambiar} />}

      <Modal visible={progreso !== null || exportado !== null} transparent animationType="fade">
        <View style={s.modalFondo}>
          <View style={s.modal}>
            {exportado ? (
              <>
                <Text style={s.modalTitulo}>¡Listo!</Text>
                <Text style={s.nota}>El video quedó guardado en tus Fotos.</Text>
                <Boton titulo="Compartir" onPress={() => Sharing.shareAsync(exportado, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' })} estilo={{ marginTop: 16 }} />
                <Boton titulo="Cerrar" tipo="secundario" onPress={() => setExportado(null)} estilo={{ marginTop: 10 }} />
              </>
            ) : (
              <>
                <Text style={s.modalTitulo}>Exportando…</Text>
                <View style={s.progresoBarra}>
                  <View style={[s.progresoRelleno, { width: `${Math.round((progreso ?? 0) * 100)}%` }]} />
                </View>
                <Text style={s.nota}>{Math.round((progreso ?? 0) * 100)} % · No cierres la app.</Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

type Panel = { p: Proyecto; cambiar: (f: (actual: Proyecto) => Proyecto) => void };

function PanelIA({ p, cambiar }: Panel) {
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const lista = useRef<ScrollViewInstance>(null);
  const sinTranscribir = p.clips.filter((c) => c.transcripcion === null);

  const enviar = async (pedido: string) => {
    const q = pedido.trim();
    if (!q || pensando) return;
    setTexto('');
    Keyboard.dismiss();
    const conPedido: Proyecto = { ...p, chat: [...p.chat, { de: 'yo', texto: q }] };
    cambiar(() => conPedido);
    setPensando(true);
    try {
      const plan = await pedirCambio(conPedido, q);
      cambiar((actual) => ({ ...aplicarPlan(actual, plan), chat: [...actual.chat, { de: 'ia', texto: plan.mensaje }] }));
    } catch (e) {
      const msg = e instanceof ErrorIA || e instanceof Error ? e.message : String(e);
      cambiar((actual) => ({ ...actual, chat: [...actual.chat, { de: 'ia', texto: `⚠️ ${msg}` }] }));
    } finally {
      setPensando(false);
    }
  };

  const transcribir = async () => {
    setTranscribiendo(true);
    try {
      const resultados = await Promise.all(sinTranscribir.map(async (c) => [c.id, await transcribirClip(p.id, c).catch(() => null)] as const));
      const mapa = new Map(resultados);
      cambiar((actual) => ({ ...actual, clips: actual.clips.map((c) => (mapa.has(c.id) ? { ...c, transcripcion: mapa.get(c.id) ?? null } : c)) }));
    } finally {
      setTranscribiendo(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={lista} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }} onContentSizeChange={() => lista.current?.scrollToEnd()}>
        {p.chat.length === 0 && <Text style={s.nota}>Pídele a Claude cambios con tus palabras: qué quitar, qué textos poner, el ritmo…</Text>}
        {p.chat.map((m, i) => (
          <View key={i} style={[s.burbuja, m.de === 'yo' ? s.burbujaYo : s.burbujaIA]}>
            <Text style={s.burbujaTexto}>{m.texto}</Text>
          </View>
        ))}
        {pensando && (
          <Fila>
            <ActivityIndicator color={tema.suave} />
            <Text style={s.nota}>Claude está editando…</Text>
          </Fila>
        )}
        {hayNativo && sinTranscribir.length > 0 && (
          <Boton titulo={`Escuchar lo que se dice (${sinTranscribir.length} clips)`} tipo="secundario" cargando={transcribiendo} onPress={transcribir} />
        )}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} style={{ flexGrow: 0 }}>
        {ATAJOS.map((a) => (
          <Chip key={a} texto={a} activo={false} onPress={() => enviar(a)} />
        ))}
      </ScrollView>
      <View style={s.entrada}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder="Ej: quita el clip 2 y pon el precio en grande"
          placeholderTextColor={tema.suave}
          style={[s.input, { flex: 1 }]}
          multiline
          editable={!pensando}
        />
        <Boton titulo="Enviar" onPress={() => enviar(texto)} deshabilitado={!texto.trim() || pensando} estilo={{ paddingVertical: 12 }} />
      </View>
    </View>
  );
}

function PanelCortes({ p, cambiar }: Panel) {
  const clips = new Map(p.clips.map((c, i) => [c.id, { c, n: i + 1 }]));
  const editar = (i: number, f: (t: Tramo) => Tramo) =>
    cambiar((a) => ({
      ...a,
      tramos: a.tramos.map((t, j) => {
        if (j !== i) return t;
        const n = f(t);
        const dur = clips.get(t.clipId)?.c.duracion ?? t.fin;
        const inicio = Math.max(0, Math.min(n.inicio, n.fin - TRAMO_MINIMO));
        const fin = Math.min(dur, Math.max(n.fin, inicio + TRAMO_MINIMO));
        return { ...n, inicio, fin };
      }),
    }));
  const mover = (i: number, d: number) =>
    cambiar((a) => {
      const tramos = [...a.tramos];
      const [t] = tramos.splice(i, 1);
      tramos.splice(i + d, 0, t);
      return { ...a, tramos };
    });
  const quitar = (i: number) => cambiar((a) => (a.tramos.length > 1 ? { ...a, tramos: a.tramos.filter((_, j) => j !== i) } : a));

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
      {p.tramos.map((t, i) => {
        const info = clips.get(t.clipId);
        return (
          <View key={t.id} style={s.tarjeta}>
            <Text style={s.tarjetaTitulo} numberOfLines={1}>
              {i + 1}. Clip {info?.n} · {formatoTiempo(t.inicio)} → {formatoTiempo(t.fin)} ({(t.fin - t.inicio).toFixed(1)} s)
            </Text>
            {info?.c.descripcion ? <Text style={s.nota} numberOfLines={1}>{info.c.descripcion}</Text> : null}
            <Fila estilo={{ marginTop: 8 }}>
              <Text style={s.mini}>Inicio</Text>
              <Mini texto="−" onPress={() => editar(i, (x) => ({ ...x, inicio: x.inicio - 0.25 }))} />
              <Mini texto="+" onPress={() => editar(i, (x) => ({ ...x, inicio: x.inicio + 0.25 }))} />
              <Text style={[s.mini, { marginLeft: 8 }]}>Fin</Text>
              <Mini texto="−" onPress={() => editar(i, (x) => ({ ...x, fin: x.fin - 0.25 }))} />
              <Mini texto="+" onPress={() => editar(i, (x) => ({ ...x, fin: x.fin + 0.25 }))} />
              <View style={{ flex: 1 }} />
              <Mini texto="↑" onPress={() => mover(i, -1)} deshabilitado={i === 0} />
              <Mini texto="↓" onPress={() => mover(i, 1)} deshabilitado={i === p.tramos.length - 1} />
              <Mini texto="✕" onPress={() => quitar(i)} deshabilitado={p.tramos.length === 1} />
            </Fila>
          </View>
        );
      })}
      <Etiqueta>Agregar un clip completo al final</Etiqueta>
      <Fila>
        {p.clips.map((c, i) => (
          <Chip
            key={c.id}
            texto={`Clip ${i + 1} (${formatoTiempo(c.duracion)})`}
            activo={false}
            onPress={() => cambiar((a) => ({ ...a, tramos: [...a.tramos, { id: nuevoId(), clipId: c.id, inicio: 0, fin: c.duracion }] }))}
          />
        ))}
      </Fila>
    </ScrollView>
  );
}

const POSICIONES: Posicion[] = ['arriba', 'centro', 'abajo'];
const ESTILOS: [Estilo, string][] = [
  ['titulo', 'Título'],
  ['subtitulo', 'Subtítulo'],
  ['etiqueta', 'Etiqueta'],
];
const ANIMACIONES: Animacion[] = ['aparecer', 'subir', 'zoom', 'rebote'];

function PanelTextos({ p, cambiar }: Panel) {
  const total = duracionTotal(p);
  const editar = (id: string, cambios: Partial<Texto>) =>
    cambiar((a) => ({ ...a, textos: a.textos.map((t) => (t.id === id ? { ...t, ...cambios } : t)) }));
  const tiempo = (t: Texto, campo: 'inicio' | 'fin', d: number) => {
    const v = Math.max(0, Math.min(total, t[campo] + d));
    if (campo === 'inicio' && v > t.fin - TRAMO_MINIMO) return;
    if (campo === 'fin' && v < t.inicio + TRAMO_MINIMO) return;
    editar(t.id, { [campo]: v });
  };
  const agregar = () =>
    cambiar((a) => ({
      ...a,
      textos: [
        ...a.textos,
        { id: nuevoId(), texto: 'Tu texto', inicio: 0, fin: Math.min(3, total), posicion: 'centro', estilo: 'titulo', animacion: 'zoom', color: '#FFFFFF' },
      ],
    }));

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Boton titulo="+ Agregar texto" tipo="secundario" onPress={agregar} />
      {p.textos.map((t) => (
        <View key={t.id} style={s.tarjeta}>
          <TextInput
            key={t.texto}
            defaultValue={t.texto}
            onEndEditing={(e) => e.nativeEvent.text.trim() && editar(t.id, { texto: e.nativeEvent.text.trim() })}
            style={[s.input, { fontWeight: '700' }]}
            multiline
          />
          <Fila estilo={{ marginTop: 8 }}>
            <Text style={s.mini}>
              {formatoTiempo(t.inicio)} → {formatoTiempo(t.fin)}
            </Text>
            <Mini texto="◀" onPress={() => tiempo(t, 'inicio', -0.25)} />
            <Mini texto="▶" onPress={() => tiempo(t, 'inicio', 0.25)} />
            <Text style={s.mini}>fin</Text>
            <Mini texto="◀" onPress={() => tiempo(t, 'fin', -0.25)} />
            <Mini texto="▶" onPress={() => tiempo(t, 'fin', 0.25)} />
            <View style={{ flex: 1 }} />
            <Mini texto="✕" onPress={() => cambiar((a) => ({ ...a, textos: a.textos.filter((x) => x.id !== t.id) }))} />
          </Fila>
          <Fila estilo={{ marginTop: 8 }}>
            {ESTILOS.map(([e, n]) => (
              <Chip key={e} texto={n} activo={t.estilo === e} onPress={() => editar(t.id, { estilo: e })} />
            ))}
          </Fila>
          <Fila estilo={{ marginTop: 8 }}>
            {POSICIONES.map((x) => (
              <Chip key={x} texto={x} activo={t.posicion === x} onPress={() => editar(t.id, { posicion: x })} />
            ))}
          </Fila>
          <Fila estilo={{ marginTop: 8 }}>
            {ANIMACIONES.map((x) => (
              <Chip key={x} texto={x} activo={t.animacion === x} onPress={() => editar(t.id, { animacion: x })} />
            ))}
          </Fila>
          <Fila estilo={{ marginTop: 10 }}>
            {COLORES.map((c) => (
              <Pressable
                key={c}
                onPress={() => editar(t.id, { color: c })}
                style={[s.color, { backgroundColor: c }, t.color.toUpperCase() === c && { borderColor: tema.acento, borderWidth: 3 }]}
              />
            ))}
          </Fila>
        </View>
      ))}
    </ScrollView>
  );
}

function PanelMas({ p, cambiar }: Panel) {
  const sinVoz = p.clips.every((c) => !c.transcripcion?.length);
  const copiar = async () => {
    if (!p.publicacion) return;
    const { titulo, descripcion, hashtags } = p.publicacion;
    await Clipboard.setStringAsync([titulo, descripcion, hashtags.join(' ')].filter(Boolean).join('\n\n'));
    Alert.alert('Copiado', 'Pégalo al publicar el video.');
  };
  const elegirMusica = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    const archivo = `musica-${nuevoId()}.${a.name.split('.').pop() ?? 'm4a'}`;
    await copiarAlProyecto(p.id, a.uri, archivo);
    cambiar((x) => ({ ...x, musica: { archivo, nombre: a.name, volumen: x.musica?.volumen ?? 0.35 } }));
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Etiqueta>Subtítulos automáticos</Etiqueta>
      <Fila>
        <Chip texto="Sí" activo={p.subtitulos} onPress={() => cambiar((x) => ({ ...x, subtitulos: true }))} />
        <Chip texto="No" activo={!p.subtitulos} onPress={() => cambiar((x) => ({ ...x, subtitulos: false }))} />
      </Fila>
      {p.subtitulos && sinVoz && (
        <Text style={s.nota}>{hayNativo ? 'Aún no hay voz transcrita: en la pestaña IA toca "Escuchar lo que se dice".' : AVISO_EXPO_GO}</Text>
      )}

      <Etiqueta>Sonido de los clips</Etiqueta>
      <Fila>
        {[
          [0, 'Sin sonido'],
          [0.5, 'Bajo'],
          [1, 'Normal'],
        ].map(([v, n]) => (
          <Chip key={n} texto={n as string} activo={p.volumenOriginal === v} onPress={() => cambiar((x) => ({ ...x, volumenOriginal: v as number }))} />
        ))}
      </Fila>

      <Etiqueta>Música</Etiqueta>
      <Fila>
        <Boton titulo={p.musica ? p.musica.nombre : 'Elegir canción'} tipo="secundario" onPress={elegirMusica} estilo={{ flex: 1 }} />
        {p.musica && <Chip texto="Quitar" activo={false} onPress={() => cambiar((x) => ({ ...x, musica: null }))} />}
      </Fila>
      {p.musica && (
        <Fila estilo={{ marginTop: 8 }}>
          {[
            [0.15, 'De fondo'],
            [0.35, 'Media'],
            [0.7, 'Alta'],
          ].map(([v, n]) => (
            <Chip
              key={n}
              texto={n as string}
              activo={p.musica?.volumen === v}
              onPress={() => cambiar((x) => (x.musica ? { ...x, musica: { ...x.musica, volumen: v as number } } : x))}
            />
          ))}
        </Fila>
      )}

      <Etiqueta>Formato</Etiqueta>
      <Fila>
        {(Object.keys(FORMATOS) as Formato[]).map((f) => (
          <Chip key={f} texto={`${FORMATOS[f].nombre} ${f}`} activo={p.formato === f} onPress={() => cambiar((x) => ({ ...x, formato: f }))} />
        ))}
      </Fila>

      <Etiqueta>Para publicar</Etiqueta>
      {p.publicacion ? (
        <View style={s.tarjeta}>
          <Text style={s.tarjetaTitulo}>{p.publicacion.titulo}</Text>
          <Text style={[s.burbujaTexto, { marginTop: 6 }]}>{p.publicacion.descripcion}</Text>
          <Text style={[s.nota, { color: '#64D2FF' }]}>{p.publicacion.hashtags.join(' ')}</Text>
          <Boton titulo="Copiar todo" tipo="secundario" onPress={copiar} estilo={{ marginTop: 10 }} />
        </View>
      ) : (
        <Text style={s.nota}>Pídele a la IA "Escribe el texto para publicar".</Text>
      )}

      <Etiqueta>Nombre</Etiqueta>
      <TextInput
        key={p.nombre}
        defaultValue={p.nombre}
        onEndEditing={(e) => e.nativeEvent.text.trim() && cambiar((x) => ({ ...x, nombre: e.nativeEvent.text.trim() }))}
        style={s.input}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  accion: { color: tema.texto, fontSize: 16, marginLeft: 14 },
  pestanas: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: tema.tarjeta, borderRadius: 12, padding: 3 },
  pestana: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  pestanaActiva: { backgroundColor: tema.borde },
  pestanaTexto: { color: tema.suave, fontWeight: '700', fontSize: 14 },
  nota: { color: tema.suave, fontSize: 13, lineHeight: 18, marginTop: 6 },
  burbuja: { borderRadius: 14, padding: 12, maxWidth: '88%' },
  burbujaYo: { backgroundColor: '#3A2A6B', alignSelf: 'flex-end' },
  burbujaIA: { backgroundColor: tema.tarjeta, alignSelf: 'flex-start' },
  burbujaTexto: { color: tema.texto, fontSize: 15, lineHeight: 21 },
  entrada: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'flex-end' },
  input: { backgroundColor: tema.tarjeta, color: tema.texto, borderRadius: 12, padding: 12, fontSize: 15, borderWidth: 1, borderColor: tema.borde, maxHeight: 110 },
  tarjeta: { backgroundColor: tema.tarjeta, borderRadius: 14, padding: 12 },
  tarjetaTitulo: { color: tema.texto, fontSize: 15, fontWeight: '700' },
  mini: { color: tema.suave, fontSize: 13 },
  color: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: tema.borde },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: tema.tarjeta, borderRadius: 18, padding: 22, width: '100%' },
  modalTitulo: { color: tema.texto, fontSize: 20, fontWeight: '800' },
  progresoBarra: { height: 8, backgroundColor: tema.borde, borderRadius: 4, marginTop: 16, overflow: 'hidden' },
  progresoRelleno: { height: 8, backgroundColor: tema.acento },
});
