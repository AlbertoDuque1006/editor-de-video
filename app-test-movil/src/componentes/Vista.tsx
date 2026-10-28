import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import { CapaTextos } from './CapaTextos';
import { uriDe } from '@/lib/almacen';
import { tema } from '@/lib/estilos';
import { FORMATOS, duracionTotal, formatoTiempo, iniciosDeTramos, subtitulosDe, ubicar } from '@/lib/proyecto';
import type { Proyecto } from '@/lib/tipos';

export interface VistaRef {
  pausar(): void;
}

/** Espera a que el reproductor pueda reproducir el archivo que se le acaba de cargar. */
function esperarListo(player: VideoPlayer): Promise<void> {
  if (player.status === 'readyToPlay') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' || status === 'error') {
        clearTimeout(espera);
        sub.remove();
        resolve();
      }
    });
    const espera = setTimeout(() => {
      sub.remove();
      resolve();
    }, 4000);
  });
}

/**
 * Vista previa: reproduce los tramos uno tras otro con un solo reproductor
 * y dibuja encima los textos y subtítulos con las mismas medidas del exportador.
 */
export const Vista = forwardRef<VistaRef, { proyecto: Proyecto; ancho: number; altoMaximo: number }>(function Vista(
  { proyecto, ancho: anchoDisponible, altoMaximo },
  ref,
) {
  const fmt = FORMATOS[proyecto.formato];
  const escala = Math.min(anchoDisponible / fmt.ancho, altoMaximo / fmt.alto);
  const ancho = fmt.ancho * escala;
  const alto = fmt.alto * escala;

  const { tramos, clips, id } = proyecto;
  const total = duracionTotal(proyecto);
  const inicios = useMemo(() => iniciosDeTramos(tramos), [tramos]);
  const subtitulos = useMemo(() => (proyecto.subtitulos ? subtitulosDe(proyecto) : []), [proyecto]);
  const uriDeTramo = useCallback(
    (i: number) => {
      const c = clips.find((x) => x.id === tramos[i]?.clipId);
      return c ? uriDe(id, c.archivo) : null;
    },
    [clips, tramos, id],
  );

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0;
  });
  const musica = useAudioPlayer(proyecto.musica ? { uri: uriDe(id, proyecto.musica.archivo) } : null);

  const [t, setT] = useState(0);
  const [tocando, setTocando] = useState(false);
  const cargada = useRef<string | null>(null);
  const indice = useRef(0);
  const ocupado = useRef(false);
  // Cada búsqueda o pausa sube la generación; una búsqueda vieja que termina tarde no toca nada.
  const generacion = useRef(0);

  useEffect(() => {
    player.volume = proyecto.volumenOriginal;
  }, [player, proyecto.volumenOriginal]);
  useEffect(() => {
    if (proyecto.musica) musica.volume = proyecto.musica.volumen;
  }, [musica, proyecto.musica]);

  const irA = useCallback(
    async (tiempo: number, reproducir: boolean) => {
      const u = ubicar(tramos, tiempo);
      const uri = u ? uriDeTramo(u.indice) : null;
      if (!u || !uri) return;
      const mia = ++generacion.current;
      const vigente = () => mia === generacion.current;
      ocupado.current = true;
      try {
        if (cargada.current !== uri) {
          cargada.current = null;
          await player.replaceAsync({ uri });
          if (!vigente()) return;
          cargada.current = uri;
          await esperarListo(player);
          if (!vigente()) return;
        }
        player.currentTime = u.tiempoClip;
        indice.current = u.indice;
        setT(tiempo);
        if (proyecto.musica && musica.duration > 0) await musica.seekTo(tiempo % musica.duration);
        if (!vigente()) return;
        if (reproducir) {
          player.play();
          if (proyecto.musica) musica.play();
        }
      } finally {
        if (vigente()) ocupado.current = false;
      }
    },
    [tramos, uriDeTramo, player, musica, proyecto.musica],
  );

  const pausar = useCallback(() => {
    generacion.current++;
    ocupado.current = false;
    player.pause();
    musica.pause();
    setTocando(false);
  }, [player, musica]);

  useImperativeHandle(ref, () => ({ pausar }), [pausar]);

  // Si el montaje cambia, se vuelve a cargar donde iba (o al final si se acortó).
  useEffect(() => {
    pausar();
    irA(Math.min(t, Math.max(0, total - 0.05)), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tramos]);

  // Mientras reproduce: mueve el reloj y salta al siguiente tramo al llegar al final del actual.
  useEffect(() => {
    if (!tocando) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ocupado.current) return;
      const i = indice.current;
      const tramo = tramos[i];
      if (!tramo) return;
      const ct = player.currentTime;
      if (ct >= tramo.fin - 0.04) {
        const sig = tramos[i + 1];
        if (!sig) {
          pausar();
          setT(total);
          return;
        }
        // Mismo clip y seguido: no hace falta saltar.
        if (sig.clipId === tramo.clipId && Math.abs(sig.inicio - tramo.fin) < 0.05) {
          indice.current = i + 1;
        } else {
          irA(inicios[i + 1], true);
          return;
        }
      }
      setT(inicios[indice.current] + Math.max(0, player.currentTime - tramos[indice.current].inicio));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tocando, tramos, inicios, player, total, irA, pausar]);

  const alternar = () => {
    if (tocando) return pausar();
    setTocando(true);
    irA(t >= total - 0.05 ? 0 : t, true);
  };

  // Barra de tiempo: tocar o arrastrar para moverse.
  const [anchoBarra, setAnchoBarra] = useState(1);
  const tiempoDeX = (x: number) => Math.min(total, Math.max(0, (x / anchoBarra) * total));

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={alternar} style={{ width: ancho, height: alto, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' }}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        <CapaTextos textos={proyecto.textos} subtitulos={subtitulos} t={t} ancho={ancho} alto={alto} />
        {!tocando && (
          <View style={s.play} pointerEvents="none">
            <Text style={s.playTexto}>▶</Text>
          </View>
        )}
      </Pressable>

      <View style={[s.controles, { width: anchoDisponible }]}>
        <Text style={s.tiempo}>
          {formatoTiempo(t)} / {formatoTiempo(total)}
        </Text>
        <View
          style={s.barra}
          onLayout={(e) => setAnchoBarra(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            pausar();
            setT(tiempoDeX(e.nativeEvent.locationX));
          }}
          onResponderMove={(e) => setT(tiempoDeX(e.nativeEvent.locationX))}
          onResponderRelease={(e) => irA(tiempoDeX(e.nativeEvent.locationX), false)}
        >
          {tramos.map((tr, i) => (
            <View
              key={tr.id}
              style={{
                position: 'absolute',
                left: (inicios[i] / (total || 1)) * anchoBarra,
                width: Math.max(2, ((tr.fin - tr.inicio) / (total || 1)) * anchoBarra - 2),
                top: 10,
                bottom: 10,
                borderRadius: 3,
                backgroundColor: i % 2 ? '#3A3A40' : '#4A4A52',
              }}
            />
          ))}
          <View style={[s.cabezal, { left: (t / (total || 1)) * anchoBarra - 1 }]} />
        </View>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  play: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playTexto: { color: 'rgba(255,255,255,0.85)', fontSize: 48 },
  controles: { marginTop: 10, gap: 6 },
  tiempo: { color: tema.suave, fontSize: 13, fontVariant: ['tabular-nums'], textAlign: 'center' },
  barra: { height: 36, backgroundColor: tema.tarjeta, borderRadius: 8, overflow: 'hidden' },
  cabezal: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: tema.acento },
});
