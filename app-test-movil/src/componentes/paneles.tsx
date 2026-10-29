import { useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { Icono } from './Icono';
import { useTiempo } from './Linea';
import { letra, tema } from './tema';
import { Accion, Boton, Celda, CeldaInterruptor, Grupo, Segmentado, tacto } from './ui';
import type { VistaRef } from './Vista';
import { copiarAlProyecto } from '@/lib/almacen';
import { COLORES } from '@/lib/estilos';
import { dividir, duplicarTramo, finAqui, inicioAqui, moverTramo, quitarTramo, tramoEn } from '@/lib/montaje';
import { AVISO_EXPO_GO, hayNativo } from '@/lib/nativo';
import { FORMATOS, TRAMO_MINIMO, duracionTotal, formatoTiempo, iniciosDeTramos, nuevoId } from '@/lib/proyecto';
import type { Animacion, Estilo, Formato, Posicion, Proyecto, Texto } from '@/lib/tipos';

/** Aplica un cambio (guardado y con deshacer). Si la función devuelve null no cambia nada y devuelve null. */
export type Cambiar = (f: (actual: Proyecto) => Proyecto | null) => Proyecto | null;

interface Base {
  p: Proyecto;
  cambiar: Cambiar;
  vista: RefObject<VistaRef | null>;
  avisar: (mensaje: string) => void;
}

const ahora = (vista: RefObject<VistaRef | null>) => vista.current?.tiempo() ?? 0;

// ——— Cortes ———

export function PanelCortes({ p, cambiar, vista, avisar, onAgregar }: Base & { onAgregar: () => void }) {
  const total = duracionTotal(p);
  const i = useTiempo(vista, (t) => tramoEn(p, Math.min(t, total - 0.001)));
  const tramo = p.tramos[i];
  const n = tramo ? p.clips.findIndex((c) => c.id === tramo.clipId) + 1 : 0;
  const clip = tramo ? p.clips[n - 1] : undefined;

  const hacer = (f: (a: Proyecto) => Proyecto | null, siNo: string) => {
    const r = cambiar(f);
    if (!r) {
      tacto.aviso();
      avisar(siNo);
    }
    return r;
  };
  const mover = (d: -1 | 1) => {
    const r = hacer((a) => moverTramo(a, i, d), d < 0 ? 'Ya es el primero.' : 'Ya es el último.');
    // El cursor se va con el clip que se movió.
    if (r) vista.current?.buscar(iniciosDeTramos(r.tramos)[i + d] + 0.01);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.panel}>
      {tramo && (
        <View style={s.info}>
          <Text style={[letra.destacado, { color: tema.texto }]}>
            Clip {n} · {(tramo.fin - tramo.inicio).toFixed(1)} s
          </Text>
          <Text style={[letra.nota, { color: tema.suave }]} numberOfLines={2}>
            Del segundo {formatoTiempo(tramo.inicio)} al {formatoTiempo(tramo.fin)} del clip
            {clip?.descripcion ? ` · ${clip.descripcion}` : ''}
          </Text>
        </View>
      )}
      <View style={s.acciones}>
        <Accion icono="tijeras" titulo="Dividir" onPress={() => hacer((a) => dividir(a, ahora(vista)), 'Muy cerca del borde para dividir.')} />
        <Accion
          icono="empiezaAqui"
          titulo="Empieza aquí"
          onPress={() => hacer((a) => inicioAqui(a, i, ahora(vista)), 'Pon el cursor dentro del clip, no en su borde.')}
        />
        <Accion
          icono="terminaAqui"
          titulo="Termina aquí"
          onPress={() => hacer((a) => finAqui(a, i, ahora(vista)), 'Pon el cursor dentro del clip, no en su borde.')}
        />
        <Accion icono="duplicar" titulo="Duplicar" onPress={() => hacer((a) => duplicarTramo(a, i), '')} />
      </View>
      <View style={s.acciones}>
        <Accion icono="izquierda" titulo="Antes" onPress={() => mover(-1)} deshabilitado={i <= 0} />
        <Accion icono="derecha" titulo="Después" onPress={() => mover(1)} deshabilitado={i < 0 || i >= p.tramos.length - 1} />
        <Accion icono="galeria" titulo="Agregar" onPress={onAgregar} />
        <Accion
          icono="basura"
          titulo="Quitar"
          peligro
          deshabilitado={p.tramos.length <= 1}
          onPress={() => hacer((a) => quitarTramo(a, i), 'El video necesita al menos un clip.')}
        />
      </View>
      <Text style={s.pista}>Desliza la tira para poner el cursor rojo. Los botones cambian el clip marcado en amarillo.</Text>
    </ScrollView>
  );
}

// ——— Textos ———

const ESTILOS = [
  ['titulo', 'Título'],
  ['subtitulo', 'Subtítulo'],
  ['etiqueta', 'Etiqueta'],
] as const satisfies readonly (readonly [Estilo, string])[];
const POSICIONES = [
  ['arriba', 'Arriba'],
  ['centro', 'Centro'],
  ['abajo', 'Abajo'],
] as const satisfies readonly (readonly [Posicion, string])[];
const ANIMACIONES = [
  ['aparecer', 'Aparecer'],
  ['subir', 'Subir'],
  ['zoom', 'Zoom'],
  ['rebote', 'Rebote'],
] as const satisfies readonly (readonly [Animacion, string])[];

export function PanelTextos({
  p,
  cambiar,
  vista,
  avisar,
  elegido,
  onElegir,
}: Base & { elegido: string | null; onElegir: (id: string | null) => void }) {
  const total = duracionTotal(p);
  const sinVoz = p.clips.every((c) => !c.transcripcion?.length);
  const editar = (id: string, cambios: Partial<Texto>) =>
    cambiar((a) => ({ ...a, textos: a.textos.map((t) => (t.id === id ? { ...t, ...cambios } : t)) }));

  const agregar = () => {
    const t = ahora(vista);
    const inicio = Math.max(0, Math.min(t, total - 3));
    const nuevo: Texto = {
      id: nuevoId(),
      texto: 'Tu texto',
      inicio,
      fin: Math.min(total, inicio + 3),
      posicion: 'centro',
      estilo: 'titulo',
      animacion: 'zoom',
      color: '#FFFFFF',
    };
    cambiar((a) => ({ ...a, textos: [...a.textos, nuevo] }));
    onElegir(nuevo.id);
  };

  const elegir = (x: Texto) => {
    onElegir(elegido === x.id ? null : x.id);
    vista.current?.buscar(x.inicio + 0.4);
  };

  const borde = (x: Texto, campo: 'inicio' | 'fin') => {
    const t = ahora(vista);
    if (campo === 'inicio' ? t > x.fin - TRAMO_MINIMO : t < x.inicio + TRAMO_MINIMO) {
      tacto.aviso();
      return avisar(campo === 'inicio' ? 'El cursor está después del final del texto.' : 'El cursor está antes del inicio del texto.');
    }
    editar(x.id, { [campo]: t });
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.panel} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Grupo estilo={{ marginTop: 0 }} pie={p.subtitulos && sinVoz ? (hayNativo ? 'Aún no hay voz transcrita: en la pestaña IA toca "Escuchar lo que se dice".' : AVISO_EXPO_GO) : undefined}>
        <CeldaInterruptor
          icono="subtitulos"
          colorIcono={tema.ok}
          titulo="Subtítulos automáticos"
          valor={p.subtitulos}
          onCambio={(v) => cambiar((a) => ({ ...a, subtitulos: v }))}
        />
      </Grupo>

      <Grupo titulo={p.textos.length ? 'Textos' : undefined}>
        {p.textos.map((x) =>
          elegido === x.id ? (
            <View key={x.id} style={s.editorTexto}>
              <TextInput
                key={x.texto}
                defaultValue={x.texto}
                onEndEditing={(e) => e.nativeEvent.text.trim() && editar(x.id, { texto: e.nativeEvent.text.trim() })}
                style={[letra.destacado, s.campoTexto]}
                multiline
                accessibilityLabel="Texto"
              />
              <Segmentado opciones={ESTILOS} valor={x.estilo} onCambio={(v) => editar(x.id, { estilo: v })} />
              <Segmentado opciones={POSICIONES} valor={x.posicion} onCambio={(v) => editar(x.id, { posicion: v })} />
              <Segmentado opciones={ANIMACIONES} valor={x.animacion} onCambio={(v) => editar(x.id, { animacion: v })} />
              <View style={s.colores}>
                {COLORES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      tacto.seleccion();
                      editar(x.id, { color: c });
                    }}
                    accessibilityLabel={`Color ${c}`}
                    accessibilityState={{ selected: x.color.toUpperCase() === c }}
                    style={[s.color, x.color.toUpperCase() === c && s.colorElegido]}
                  >
                    <View style={[s.colorPunto, { backgroundColor: c }]} />
                  </Pressable>
                ))}
              </View>
              <Text style={[letra.nota, { color: tema.suave, fontVariant: ['tabular-nums'] }]}>
                Se ve de {formatoTiempo(x.inicio)} a {formatoTiempo(x.fin)}
              </Text>
              <View style={s.acciones}>
                <Accion icono="empiezaAqui" titulo="Empieza aquí" onPress={() => borde(x, 'inicio')} />
                <Accion icono="terminaAqui" titulo="Termina aquí" onPress={() => borde(x, 'fin')} />
                <Accion icono="check" titulo="Listo" onPress={() => onElegir(null)} />
                <Accion
                  icono="basura"
                  titulo="Quitar"
                  peligro
                  onPress={() => {
                    cambiar((a) => ({ ...a, textos: a.textos.filter((y) => y.id !== x.id) }));
                    onElegir(null);
                  }}
                />
              </View>
            </View>
          ) : (
            <Celda
              key={x.id}
              icono="texto"
              colorIcono={tema.morado}
              titulo={x.texto}
              subtitulo={`${formatoTiempo(x.inicio)} – ${formatoTiempo(x.fin)} · ${ESTILOS.find(([e]) => e === x.estilo)?.[1] ?? ''}`}
              accesorio="flecha"
              onPress={() => elegir(x)}
            />
          ),
        )}
        <Celda icono="mas" colorIcono={tema.acento} titulo="Agregar texto en el cursor" accion onPress={agregar} />
      </Grupo>
    </ScrollView>
  );
}

// ——— Más ———

const VOLUMEN_CLIPS = [
  [0, 'Sin sonido'],
  [0.5, 'Bajo'],
  [1, 'Normal'],
] as const;
const VOLUMEN_MUSICA = [
  [0.15, 'De fondo'],
  [0.35, 'Media'],
  [0.7, 'Alta'],
] as const;
const FORMATOS_OPCIONES = (Object.keys(FORMATOS) as Formato[]).map((f) => [f, FORMATOS[f].nombre] as const);

export function PanelMas({ p, cambiar, avisar, pedirIA, pensando }: Base & { pedirIA: (pedido: string) => void; pensando: boolean }) {
  const copiar = async () => {
    if (!p.publicacion) return;
    const { titulo, descripcion, hashtags } = p.publicacion;
    await Clipboard.setStringAsync([titulo, descripcion, hashtags.join(' ')].filter(Boolean).join('\n\n'));
    tacto.exito();
    avisar('Copiado. Pégalo al publicar el video.');
  };
  const elegirMusica = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    const archivo = `musica-${nuevoId()}.${a.name.split('.').pop() ?? 'm4a'}`;
    await copiarAlProyecto(p.id, a.uri, archivo);
    cambiar((x) => ({ ...x, musica: { archivo, nombre: a.name, volumen: x.musica?.volumen ?? 0.35 } }));
  };
  const renombrar = () =>
    Alert.prompt(
      'Nombre del video',
      undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Guardar', isPreferred: true, onPress: (n?: string) => n?.trim() && cambiar((x) => ({ ...x, nombre: n.trim() })) },
      ],
      'plain-text',
      p.nombre,
    );
  const valorMusica = p.musica ? (VOLUMEN_MUSICA.find(([v]) => v === p.musica?.volumen)?.[0] ?? 0.35) : 0.35;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.panel}>
      <Grupo titulo="Para publicar" estilo={{ marginTop: 0 }}>
        {p.publicacion ? (
          <View style={{ padding: 16, gap: 8 }}>
            <Text style={[letra.destacado, { color: tema.texto }]}>{p.publicacion.titulo}</Text>
            <Text style={[letra.subtitulo, { color: tema.texto, lineHeight: 21 }]}>{p.publicacion.descripcion}</Text>
            <Text style={[letra.subtitulo, { color: tema.acento }]}>{p.publicacion.hashtags.join(' ')}</Text>
          </View>
        ) : (
          <Celda titulo="Aún no hay texto para publicar" subtitulo="Claude escribe el título, la descripción y los hashtags." />
        )}
        {p.publicacion && <Celda icono="copiar" colorIcono={tema.acento} titulo="Copiar todo" accion onPress={copiar} />}
        <Celda
          icono="ia"
          colorIcono={tema.morado}
          titulo={p.publicacion ? 'Escribirlo de nuevo con IA' : 'Escribirlo con IA'}
          accion
          deshabilitado={pensando}
          accesorio={pensando ? <ActivityIndicator color={tema.suave} /> : undefined}
          onPress={() => pedirIA('Escribe el texto para publicar')}
        />
      </Grupo>

      <Grupo titulo="Sonido de los clips">
        <View style={s.control}>
          <Segmentado opciones={VOLUMEN_CLIPS} valor={p.volumenOriginal} onCambio={(v) => cambiar((x) => ({ ...x, volumenOriginal: v }))} />
        </View>
      </Grupo>

      <Grupo titulo="Música">
        <Celda icono="musica" colorIcono={tema.cursor} titulo="Canción" valor={p.musica?.nombre ?? 'Ninguna'} accesorio="flecha" onPress={elegirMusica} />
        {p.musica && (
          <View style={s.control}>
            <Segmentado
              opciones={VOLUMEN_MUSICA}
              valor={valorMusica}
              onCambio={(v) => cambiar((x) => (x.musica ? { ...x, musica: { ...x.musica, volumen: v } } : null))}
            />
          </View>
        )}
        {p.musica && <Celda titulo="Quitar la música" destructivo onPress={() => cambiar((x) => ({ ...x, musica: null }))} />}
      </Grupo>

      <Grupo titulo="Formato" pie={FORMATOS[p.formato].uso}>
        <View style={s.control}>
          <Segmentado opciones={FORMATOS_OPCIONES} valor={p.formato} onCambio={(f) => cambiar((x) => ({ ...x, formato: f }))} />
        </View>
      </Grupo>

      <Grupo titulo="Video">
        <Celda icono="lapiz" colorIcono={tema.naranja} titulo="Nombre" valor={p.nombre} accesorio="flecha" onPress={renombrar} />
      </Grupo>
    </ScrollView>
  );
}

// ——— IA ———

const ATAJOS = [
  'Hazlo más corto y dinámico',
  'Pon un título con gancho al inicio',
  'Agrega subtítulos',
  'Quita los silencios y las muletillas',
  'Agrega un llamado a la acción al final',
  'Escribe el texto para publicar',
];

export function PanelIA({
  p,
  pensando,
  pedirIA,
  transcribiendo,
  onTranscribir,
}: {
  p: Proyecto;
  pensando: boolean;
  pedirIA: (pedido: string) => void;
  transcribiendo: boolean;
  onTranscribir: () => void;
}) {
  const [texto, setTexto] = useState('');
  const lista = useRef<ScrollViewInstance>(null);
  const sinTranscribir = p.clips.filter((c) => c.transcripcion === null).length;
  const enviar = (q: string) => {
    if (!q.trim() || pensando) return;
    setTexto('');
    pedirIA(q);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={lista}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        onContentSizeChange={() => p.chat.length > 0 && lista.current?.scrollToEnd()}
        keyboardDismissMode="interactive"
      >
        {p.chat.length === 0 && (
          <View style={s.chatVacio}>
            <Icono nombre="ia" tamano={30} color={tema.morado} />
            <Text style={[letra.subtitulo, { color: tema.suave, textAlign: 'center', lineHeight: 21 }]}>
              Pídele a Claude cambios con tus palabras: qué quitar, qué textos poner, el ritmo…
            </Text>
          </View>
        )}
        {p.chat.map((m, i) => (
          <View key={i} style={[s.burbuja, m.de === 'yo' ? s.burbujaYo : s.burbujaIA]}>
            <Text style={[letra.cuerpo, { color: m.de === 'yo' ? '#FFFFFF' : tema.texto, lineHeight: 22 }]}>{m.texto}</Text>
          </View>
        ))}
        {pensando && (
          <View style={[s.burbuja, s.burbujaIA, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
            <ActivityIndicator color={tema.suave} />
            <Text style={[letra.subtitulo, { color: tema.suave }]}>Claude está editando…</Text>
          </View>
        )}
        {hayNativo && sinTranscribir > 0 && (
          <Boton
            titulo={`Escuchar lo que se dice (${sinTranscribir} ${sinTranscribir === 1 ? 'clip' : 'clips'})`}
            icono="oido"
            tipo="gris"
            pequeno
            cargando={transcribiendo}
            onPress={onTranscribir}
            estilo={{ alignSelf: 'center', marginTop: 8 }}
          />
        )}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
        {ATAJOS.map((a) => (
          <Pressable
            key={a}
            disabled={pensando}
            onPress={() => {
              tacto.toque();
              enviar(a);
            }}
            style={({ pressed }) => [s.atajo, (pressed || pensando) && { opacity: 0.5 }]}
          >
            <Icono nombre="rayo" tamano={12} color={tema.morado} />
            <Text style={[letra.subtitulo, { color: tema.texto }]}>{a}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.entrada}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder="Pídele un cambio a Claude"
          placeholderTextColor={tema.tenue}
          style={[letra.cuerpo, s.campoChat]}
          multiline
          editable={!pensando}
          accessibilityLabel="Mensaje para Claude"
        />
        <Pressable
          onPress={() => enviar(texto)}
          disabled={!texto.trim() || pensando}
          accessibilityRole="button"
          accessibilityLabel="Enviar"
          hitSlop={6}
          style={[s.enviar, (!texto.trim() || pensando) && { backgroundColor: tema.gris }]}
        >
          <Icono nombre="enviar" tamano={16} color="#FFFFFF" peso="bold" />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  info: { gap: 3, marginBottom: 8, paddingHorizontal: 4 },
  acciones: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  pista: { ...letra.nota, color: tema.suave, textAlign: 'center', marginTop: 10, paddingHorizontal: 12, lineHeight: 18 },
  control: { padding: 12 },
  editorTexto: { padding: 14, gap: 12 },
  campoTexto: { color: tema.texto, backgroundColor: tema.relleno, borderRadius: 10, padding: 12, paddingTop: 10 },
  colores: { flexDirection: 'row', justifyContent: 'space-between' },
  color: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  colorElegido: { borderColor: tema.acento },
  colorPunto: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  chatVacio: { alignItems: 'center', gap: 10, paddingVertical: 20, paddingHorizontal: 24 },
  burbuja: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '85%' },
  burbujaYo: { backgroundColor: tema.acento, alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  burbujaIA: { backgroundColor: tema.tarjeta, alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  atajo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: tema.tarjeta,
    borderRadius: 17,
    paddingHorizontal: 13,
    minHeight: 34,
  },
  entrada: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'flex-end' },
  campoChat: {
    flex: 1,
    color: tema.texto,
    backgroundColor: tema.tarjeta,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 9,
    minHeight: 40,
    maxHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tema.separador,
  },
  enviar: { width: 34, height: 34, borderRadius: 17, backgroundColor: tema.acento, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
});
