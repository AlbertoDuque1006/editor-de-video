import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { Icono } from './Icono';
import { letra, tema } from './tema';
import { tacto } from './ui';
import type { VistaRef } from './Vista';
import { uriDe } from '@/lib/almacen';
import { fotogramas } from '@/lib/medios';
import { tramoEn } from '@/lib/montaje';
import { duracionTotal, iniciosDeTramos } from '@/lib/proyecto';
import type { Clip, Proyecto } from '@/lib/tipos';

const ALTO_CLIP = 54;
const ALTO_TEXTO = 24;
const MAX_FOTOS = 40;

/** Escucha el tiempo de la vista previa y guarda solo lo que se elija de él (para no redibujar en cada fotograma). */
export function useTiempo<T>(vista: RefObject<VistaRef | null>, elegir: (t: number) => T): T {
  const elegirRef = useRef(elegir);
  elegirRef.current = elegir;
  const [valor, setValor] = useState(() => elegir(vista.current?.tiempo() ?? 0));
  useEffect(() => {
    const v = vista.current;
    if (!v) return;
    setValor(elegirRef.current(v.tiempo()));
    return v.suscribir((t) => setValor(elegirRef.current(t)));
  }, [vista]);
  return valor;
}

/** Fotos pequeñas de cada clip cada `paso` segundos, para dibujar la tira de la línea de tiempo. */
function useFotogramas(proyectoId: string, clips: Clip[]) {
  const [fotos, setFotos] = useState<Record<string, { paso: number; lista: VideoThumbnail[] }>>({});
  const pedidas = useRef(new Set<string>());
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );
  // Cada clip se pide una sola vez y su resultado se guarda aunque el proyecto cambie mientras tanto.
  useEffect(() => {
    for (const c of clips) {
      if (pedidas.current.has(c.id) || !c.duracion) continue;
      pedidas.current.add(c.id);
      const paso = Math.max(1, c.duracion / MAX_FOTOS);
      const tiempos = Array.from({ length: Math.max(1, Math.floor(c.duracion / paso)) }, (_, j) => Math.min(c.duracion - 0.05, j * paso + paso / 2));
      void fotogramas(uriDe(proyectoId, c.archivo), tiempos, ALTO_CLIP * 2)
        .catch(() => [])
        .then((lista) => {
          if (montado.current && lista.length) setFotos((x) => ({ ...x, [c.id]: { paso, lista } }));
        });
    }
  }, [proyectoId, clips]);
  return fotos;
}

/**
 * Línea de tiempo como la de iMovie: el cursor rojo queda fijo en el centro y se arrastra la tira.
 * El clip que está bajo el cursor es el que se edita (se marca en amarillo).
 */
export function Linea({
  p,
  vista,
  ancho,
  textoElegido,
  onElegirTexto,
  onAgregar,
}: {
  p: Proyecto;
  vista: RefObject<VistaRef | null>;
  ancho: number;
  textoElegido: string | null;
  onElegirTexto: (id: string) => void;
  onAgregar: () => void;
}) {
  const total = duracionTotal(p);
  // Que el video entero quepa en unas dos pantallas, sin que los clips cortos queden diminutos.
  const pps = Math.max(28, Math.min(110, (ancho * 2) / Math.max(total, 1)));
  const inicios = useMemo(() => iniciosDeTramos(p.tramos), [p.tramos]);
  const fotos = useFotogramas(p.id, p.clips);
  const clips = useMemo(() => new Map(p.clips.map((c) => [c.id, c])), [p.clips]);
  const actual = useTiempo(vista, (t) => tramoEn(p, Math.min(t, total - 0.001)));

  const lista = useRef<ScrollViewInstance>(null);
  const usuario = useRef(false);
  const soltar = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mientras reproduce (o cuando otro cambia el tiempo), la tira sigue al cursor.
  useEffect(() => {
    const v = vista.current;
    if (!v) return;
    lista.current?.scrollTo({ x: v.tiempo() * pps, animated: false });
    return v.suscribir((t) => {
      if (!usuario.current) lista.current?.scrollTo({ x: t * pps, animated: false });
    });
  }, [vista, pps]);

  const empezar = () => {
    if (soltar.current) clearTimeout(soltar.current);
    usuario.current = true;
  };
  const terminar = () => {
    if (soltar.current) clearTimeout(soltar.current);
    soltar.current = setTimeout(() => (usuario.current = false), 120);
  };

  const mitad = ancho / 2;
  const anchoContenido = total * pps;

  return (
    <View style={{ height: ALTO_CLIP + ALTO_TEXTO + 22 }}>
      <ScrollView
        ref={lista}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: mitad, paddingTop: 8 }}
        onScrollBeginDrag={empezar}
        onMomentumScrollBegin={empezar}
        onScrollEndDrag={terminar}
        onMomentumScrollEnd={terminar}
        onScroll={(e) => {
          if (usuario.current) vista.current?.buscar(e.nativeEvent.contentOffset.x / pps);
        }}
        accessibilityLabel="Línea de tiempo"
        accessibilityHint="Desliza para mover el cursor"
      >
        <View style={{ width: anchoContenido + 64 }}>
          <View style={{ flexDirection: 'row', height: ALTO_CLIP, alignItems: 'center' }}>
            {p.tramos.map((tr, i) => {
              // Ancho exacto (sin márgenes) para que la posición en pantalla y el tiempo coincidan siempre.
              const w = (tr.fin - tr.inicio) * pps;
              const c = clips.get(tr.clipId);
              const f = fotos[tr.clipId];
              const primera = f?.lista[0];
              const anchoFoto = primera ? Math.max(18, (ALTO_CLIP * primera.width) / primera.height) : ALTO_CLIP;
              const celdas = Math.ceil(w / anchoFoto);
              return (
                <Pressable
                  key={tr.id}
                  onPress={(e) => {
                    tacto.seleccion();
                    const x = e.nativeEvent.locationX;
                    vista.current?.buscar(inicios[i] + (Number.isFinite(x) ? Math.min(Math.max(0, x), w - 1) / pps : 0.01));
                  }}
                  accessibilityLabel={`Tramo ${i + 1}, ${(tr.fin - tr.inicio).toFixed(1)} segundos`}
                  style={[s.tramo, { width: w }, i === actual && s.tramoActual]}
                >
                  <View style={s.tira}>
                    {f
                      ? Array.from({ length: Math.min(celdas, 200) }, (_, k) => {
                          const tiempo = tr.inicio + ((k + 0.5) * anchoFoto) / pps;
                          const foto = f.lista[Math.min(f.lista.length - 1, Math.max(0, Math.floor(tiempo / f.paso)))];
                          return <Image key={k} source={foto} style={{ width: anchoFoto, height: ALTO_CLIP }} contentFit="cover" />;
                        })
                      : null}
                  </View>
                  <View style={s.division} />
                  {w > 34 && c && (
                    <Text style={s.tramoNumero} numberOfLines={1}>
                      {p.clips.indexOf(c) + 1}
                    </Text>
                  )}
                </Pressable>
              );
            })}
            <Pressable onPress={onAgregar} accessibilityRole="button" accessibilityLabel="Agregar un clip" style={({ pressed }) => [s.agregar, pressed && { opacity: 0.5 }]}>
              <Icono nombre="mas" tamano={20} color={tema.texto} peso="semibold" />
            </Pressable>
          </View>
          <View style={{ height: ALTO_TEXTO, marginTop: 6 }}>
            {p.textos.map((x) => (
              <Pressable
                key={x.id}
                onPress={() => {
                  tacto.seleccion();
                  onElegirTexto(x.id);
                }}
                accessibilityLabel={`Texto: ${x.texto}`}
                style={[
                  s.texto,
                  { left: x.inicio * pps, width: Math.max(10, (x.fin - x.inicio) * pps - 2) },
                  textoElegido === x.id && s.textoElegido,
                ]}
              >
                <Icono nombre="texto" tamano={10} color="#FFFFFF" />
                <Text style={s.textoTitulo} numberOfLines={1}>
                  {x.texto}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      <View pointerEvents="none" style={[s.cursor, { left: mitad - 1 }]}>
        <View style={s.cursorCabeza} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tramo: {
    height: ALTO_CLIP,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: tema.relleno,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tramoActual: { borderColor: tema.seleccion },
  division: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 2, backgroundColor: tema.fondo },
  tira: { flexDirection: 'row', height: '100%', overflow: 'hidden', opacity: 0.92 },
  tramoNumero: {
    position: 'absolute',
    left: 4,
    top: 3,
    ...letra.leyenda2,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 4,
  },
  agregar: {
    width: 46,
    height: ALTO_CLIP,
    borderRadius: 8,
    marginLeft: 8,
    backgroundColor: tema.gris,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: {
    position: 'absolute',
    top: 0,
    height: ALTO_TEXTO,
    borderRadius: 6,
    backgroundColor: tema.morado,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  textoElegido: { borderColor: tema.seleccion },
  textoTitulo: { ...letra.leyenda2, color: '#FFFFFF', fontWeight: '600', flexShrink: 1 },
  cursor: { position: 'absolute', top: 2, bottom: 0, width: 2, backgroundColor: tema.cursor, borderRadius: 1 },
  cursorCabeza: { position: 'absolute', top: -2, left: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: tema.cursor },
});
