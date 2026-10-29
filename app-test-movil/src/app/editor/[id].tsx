import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Animated, Keyboard, KeyboardAvoidingView, Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Icono, sf } from '@/componentes/Icono';
import { Linea, useTiempo } from '@/componentes/Linea';
import { PanelCortes, PanelIA, PanelMas, PanelTextos, type Cambiar } from '@/componentes/paneles';
import { letra, tema } from '@/componentes/tema';
import { Boton, BotonIcono, Segmentado, tacto } from '@/componentes/ui';
import { Vista, type VistaRef } from '@/componentes/Vista';
import { copiarAlProyecto, guardarProyecto, leerProyecto, uriDe } from '@/lib/almacen';
import { ErrorIA, pedirCambio } from '@/lib/ia';
import { guardarPortada, medirVideo } from '@/lib/medios';
import { insertarTramo, tramoEn } from '@/lib/montaje';
import { AVISO_EXPO_GO, exportar, hayNativo, transcribirClip } from '@/lib/nativo';
import { aplicarPlan, duracionTotal, formatoTiempo, nuevoId } from '@/lib/proyecto';
import type { Clip, Proyecto } from '@/lib/tipos';

type Pestana = 'ia' | 'cortes' | 'textos' | 'mas';
const PESTANAS = [
  ['ia', 'IA'],
  ['cortes', 'Cortes'],
  ['textos', 'Textos'],
  ['mas', 'Más'],
] as const satisfies readonly (readonly [Pestana, string])[];

export default function Editor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [p, setP] = useState<Proyecto | null>(() => leerProyecto(id));
  // Copia al día del proyecto: varios cambios seguidos (antes y después de esperar a la IA) se encadenan bien.
  const actual = useRef(p);
  const historial = useRef<Proyecto[]>([]);
  const rehechos = useRef<Proyecto[]>([]);
  const [pestana, setPestana] = useState<Pestana>('ia');
  const [teclado, setTeclado] = useState(false);
  const [zonaSegura, setZonaSegura] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [textoElegido, setTextoElegido] = useState<string | null>(null);
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

  // Aviso corto arriba del video, en vez de una alerta que interrumpe.
  const [mensaje, setMensaje] = useState<string | null>(null);
  const opacidad = useRef(new Animated.Value(0)).current;
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback(
    (m: string) => {
      if (!m) return;
      setMensaje(m);
      Animated.timing(opacidad, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      if (reloj.current) clearTimeout(reloj.current);
      reloj.current = setTimeout(() => Animated.timing(opacidad, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setMensaje(null)), 2200);
    },
    [opacidad],
  );

  const poner = (nuevo: Proyecto) => {
    actual.current = nuevo;
    setP(nuevo);
    guardarProyecto(nuevo);
  };

  /** Todo cambio pasa por aquí: se guarda en disco y se puede deshacer. */
  const cambiar: Cambiar = useCallback((f) => {
    const antes = actual.current;
    if (!antes) return null;
    const r = f(antes);
    if (!r) return null;
    const nuevo = { ...r, editado: Date.now() };
    historial.current.push(antes);
    if (historial.current.length > 50) historial.current.shift();
    rehechos.current = [];
    poner(nuevo);
    return nuevo;
  }, []);

  const deshacer = () => {
    const anterior = historial.current.pop();
    if (!anterior || !actual.current) return;
    rehechos.current.push(actual.current);
    poner(anterior);
    tacto.toque();
  };
  const rehacer = () => {
    const siguiente = rehechos.current.pop();
    if (!siguiente || !actual.current) return;
    historial.current.push(actual.current);
    poner(siguiente);
    tacto.toque();
  };

  // La portada de la lista de videos es la primera imagen del montaje.
  const primero = p?.tramos[0];
  useEffect(() => {
    if (!p || !primero) return;
    const c = p.clips.find((x) => x.id === primero.clipId);
    if (!c) return;
    const t = setTimeout(() => void guardarPortada(p.id, uriDe(p.id, c.archivo), primero.inicio + 0.3).catch(() => {}), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primero?.clipId, primero?.inicio]);

  // IA
  const [pensando, setPensando] = useState(false);
  const pedirIA = async (pedido: string) => {
    const q = pedido.trim();
    if (!q || pensando || !actual.current) return;
    Keyboard.dismiss();
    setPestana('ia');
    vista.current?.pausar();
    const conPedido = cambiar((a) => ({ ...a, chat: [...a.chat, { de: 'yo', texto: q }] }));
    if (!conPedido) return;
    setPensando(true);
    try {
      const plan = await pedirCambio(conPedido, q);
      cambiar((a) => ({ ...aplicarPlan(a, plan), chat: [...a.chat, { de: 'ia', texto: plan.mensaje }] }));
      tacto.exito();
    } catch (e) {
      const msg = e instanceof ErrorIA || e instanceof Error ? e.message : String(e);
      cambiar((a) => ({ ...a, chat: [...a.chat, { de: 'ia', texto: `No pude hacer el cambio: ${msg}` }] }));
      tacto.aviso();
    } finally {
      setPensando(false);
    }
  };

  const [transcribiendo, setTranscribiendo] = useState(false);
  const transcribir = async () => {
    const pendientes = actual.current?.clips.filter((c) => c.transcripcion === null) ?? [];
    setTranscribiendo(true);
    try {
      const resultados = await Promise.all(pendientes.map(async (c) => [c.id, await transcribirClip(id, c).catch(() => null)] as const));
      const mapa = new Map(resultados);
      cambiar((a) => ({ ...a, clips: a.clips.map((c) => (mapa.has(c.id) ? { ...c, transcripcion: mapa.get(c.id) ?? null } : c)) }));
    } finally {
      setTranscribiendo(false);
    }
  };

  // Agregar un clip después del que está bajo el cursor: uno que ya está en el proyecto o uno nuevo de la galería.
  const ponerTramos = (clips: Clip[], extra: Clip[] = []) =>
    cambiar((a) => {
      const total = duracionTotal(a);
      let r: Proyecto = { ...a, clips: [...a.clips, ...extra] };
      let donde = tramoEn(a, Math.min(vista.current?.tiempo() ?? total, total - 0.001)) + 1;
      if (donde <= 0) donde = a.tramos.length;
      for (const c of clips) r = insertarTramo(r, donde++, { id: nuevoId(), clipId: c.id, inicio: 0, fin: c.duracion });
      return r;
    });

  const desdeGaleria = async () => {
    await ImagePicker.requestMediaLibraryPermissionsAsync();
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: 10, orderedSelection: true });
    if (r.canceled || !actual.current) return;
    avisar('Agregando…');
    const nuevos: Clip[] = [];
    let fallo: unknown = null;
    for (const v of r.assets) {
      try {
        const n = (actual.current?.clips.length ?? 0) + nuevos.length + 1;
        const ext = (v.fileName ?? v.uri).split('?')[0].split('.').pop()?.toLowerCase() || 'mov';
        const archivo = `clip-${n}-${nuevoId().slice(-4)}.${ext}`;
        await copiarAlProyecto(id, v.uri, archivo);
        let dur = v.duration ? v.duration / 1000 : 0;
        let { width: ancho, height: alto } = v;
        if (!dur || !ancho) {
          const m = await medirVideo(uriDe(id, archivo));
          dur = m.duracion;
          ancho = m.ancho;
          alto = m.alto;
        }
        const clip: Clip = { id: nuevoId(), archivo, nombre: v.fileName ?? `Clip ${n}`, duracion: dur, ancho, alto, transcripcion: null, descripcion: '' };
        if (hayNativo) clip.transcripcion = await transcribirClip(id, clip).catch(() => null);
        nuevos.push(clip);
      } catch (e) {
        fallo = e;
      }
    }
    // Los que sí se copiaron entran al video aunque otro haya fallado.
    if (nuevos.length) ponerTramos(nuevos, nuevos);
    if (fallo) {
      tacto.aviso();
      Alert.alert(
        nuevos.length ? `Se agregaron ${nuevos.length} de ${r.assets.length} clips` : 'No se pudo agregar el clip',
        fallo instanceof Error ? fallo.message : String(fallo),
      );
    } else {
      tacto.exito();
      avisar(nuevos.length === 1 ? 'Clip agregado' : `${nuevos.length} clips agregados`);
    }
  };

  const agregarClip = () => {
    const a = actual.current;
    if (!a) return;
    vista.current?.pausar();
    const opciones = ['Elegir de la galería…', ...a.clips.map((c, i) => `Clip ${i + 1} completo (${formatoTiempo(c.duracion)})`), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Agregar después del clip marcado', options: opciones, cancelButtonIndex: opciones.length - 1 },
      (i) => {
        if (i === 0) desdeGaleria().catch((e) => Alert.alert('No se pudo abrir la galería', e instanceof Error ? e.message : String(e)));
        else if (i > 0 && i < opciones.length - 1) ponerTramos([a.clips[i - 1]]);
      },
    );
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
      tacto.exito();
    } catch (e) {
      tacto.aviso();
      Alert.alert('No se pudo exportar', e instanceof Error ? e.message : String(e));
    } finally {
      deactivateKeepAwake();
      setProgreso(null);
    }
  };

  if (!p) return <Text style={{ color: tema.texto, padding: 20 }}>No encontré este video.</Text>;

  const altoVista = teclado ? 140 : Math.max(180, Math.min(height * 0.36, 380));
  const panel = { p, cambiar, vista, avisar };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: tema.fondo }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen options={{ title: p.nombre }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={sf('deshacer')} accessibilityLabel="Deshacer" disabled={historial.current.length === 0} onPress={deshacer} />
        <Stack.Toolbar.Button icon={sf('rehacer')} accessibilityLabel="Rehacer" disabled={rehechos.current.length === 0} onPress={rehacer} />
        <Stack.Toolbar.Menu icon={sf('mas3')} accessibilityLabel="Más opciones">
          <Stack.Toolbar.MenuAction icon={sf('zonaSegura')} isOn={zonaSegura} onPress={() => setZonaSegura((z) => !z)}>
            Zona segura de Reels y TikTok
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={sf('galeria')} onPress={agregarClip}>
            Agregar un clip
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button variant="prominent" accessibilityLabel="Exportar" onPress={exportarVideo}>
          Exportar
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <View style={{ paddingTop: 4 }}>
        <Vista ref={vista} proyecto={p} ancho={width - 32} altoMaximo={altoVista} zonaSegura={zonaSegura} onReproduciendo={setTocando} />
        {mensaje && (
          <Animated.View pointerEvents="none" style={[s.hud, { opacity: opacidad }]}>
            <Text style={[letra.subtitulo, { color: '#FFFFFF', fontWeight: '600' }]}>{mensaje}</Text>
          </Animated.View>
        )}
      </View>

      {!teclado && (
        <>
          <View style={s.transporte}>
            <Reloj vista={vista} total={duracionTotal(p)} />
            <BotonIcono icono="alInicio" etiqueta="Ir al inicio" tamano={40} fondo="transparent" onPress={() => vista.current?.buscar(0)} />
            <BotonIcono
              icono={tocando ? 'pausa' : 'play'}
              etiqueta={tocando ? 'Pausar' : 'Reproducir'}
              tamano={48}
              fondo={tema.gris}
              onPress={() => vista.current?.alternar()}
            />
            <View style={{ width: 40 }} />
            <View style={s.derecha}>
              <BotonIcono
                icono="zonaSegura"
                etiqueta="Zona segura de Reels y TikTok"
                tamano={36}
                activo={zonaSegura}
                fondo={zonaSegura ? tema.acento : 'transparent'}
                onPress={() => {
                  setZonaSegura((z) => !z);
                  avisar(zonaSegura ? 'Zona segura oculta' : 'Lo que queda fuera del recuadro lo tapan los botones de Reels y TikTok');
                }}
              />
            </View>
          </View>
          <Linea
            p={p}
            vista={vista}
            ancho={width}
            textoElegido={textoElegido}
            onElegirTexto={(tid) => {
              setTextoElegido(tid);
              setPestana('textos');
              const x = p.textos.find((y) => y.id === tid);
              if (x) vista.current?.buscar(x.inicio + 0.4);
            }}
            onAgregar={agregarClip}
          />
        </>
      )}

      <View style={s.pestanas}>
        <Segmentado opciones={PESTANAS} valor={pestana} onCambio={setPestana} />
      </View>

      {pestana === 'ia' && <PanelIA p={p} pensando={pensando} pedirIA={pedirIA} transcribiendo={transcribiendo} onTranscribir={transcribir} />}
      {pestana === 'cortes' && <PanelCortes {...panel} onAgregar={agregarClip} />}
      {pestana === 'textos' && <PanelTextos {...panel} elegido={textoElegido} onElegir={setTextoElegido} />}
      {pestana === 'mas' && <PanelMas {...panel} pedirIA={pedirIA} pensando={pensando} />}

      <Modal visible={progreso !== null || exportado !== null} transparent animationType="fade">
        <View style={s.modalFondo}>
          <View style={s.modal}>
            {exportado ? (
              <>
                <Icono nombre="checkCirculo" tamano={52} color={tema.ok} />
                <Text style={[letra.titulo3, { color: tema.texto }]}>Listo</Text>
                <Text style={[letra.subtitulo, { color: tema.suave, textAlign: 'center' }]}>El video quedó guardado en tus Fotos.</Text>
                <Boton
                  titulo="Compartir"
                  icono="compartir"
                  onPress={() => Sharing.shareAsync(exportado, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' })}
                  estilo={{ alignSelf: 'stretch', marginTop: 8 }}
                />
                <Boton titulo="Cerrar" tipo="plano" onPress={() => setExportado(null)} estilo={{ alignSelf: 'stretch' }} />
              </>
            ) : (
              <>
                <Text style={[letra.titulo3, { color: tema.texto }]}>Exportando…</Text>
                <View style={s.progresoBarra}>
                  <View style={[s.progresoRelleno, { width: `${Math.round((progreso ?? 0) * 100)}%` }]} />
                </View>
                <Text style={[letra.nota, { color: tema.suave, fontVariant: ['tabular-nums'] }]}>
                  {Math.round((progreso ?? 0) * 100)} % · No cierres la app
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

/** El tiempo del cursor, que se redibuja solo (no toda la pantalla). */
function Reloj({ vista, total }: { vista: React.RefObject<VistaRef | null>; total: number }) {
  const t = useTiempo(vista, (x) => Math.floor(x * 10) / 10);
  return (
    <View style={s.reloj}>
      <Text style={[letra.subtitulo, { color: tema.texto, fontVariant: ['tabular-nums'], fontWeight: '600' }]}>{formatoTiempo(t)}</Text>
      <Text style={[letra.leyenda, { color: tema.suave, fontVariant: ['tabular-nums'] }]}>de {formatoTiempo(total)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hud: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    maxWidth: '86%',
    backgroundColor: 'rgba(28,28,30,0.92)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  transporte: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  reloj: { position: 'absolute', left: 16, top: 0, bottom: 0, justifyContent: 'center' },
  derecha: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  pestanas: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  modal: { backgroundColor: tema.tarjeta, borderRadius: 22, padding: 24, width: '100%', alignItems: 'center', gap: 10 },
  progresoBarra: { height: 6, alignSelf: 'stretch', backgroundColor: tema.gris, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  progresoRelleno: { height: 6, backgroundColor: tema.acento },
});
