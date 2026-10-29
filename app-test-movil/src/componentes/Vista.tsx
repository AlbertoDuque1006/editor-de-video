import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import { CapaTextos } from './CapaTextos';
import { Icono } from './Icono';
import { uriDe } from '@/lib/almacen';
import { FORMATOS, duracionTotal, iniciosDeTramos, subtitulosDe, ubicar } from '@/lib/proyecto';
import type { Proyecto } from '@/lib/tipos';

export interface VistaRef {
  pausar(): void;
  alternar(): void;
  /** Mueve el cursor sin reproducir. Se puede llamar muchas veces seguidas (al arrastrar la línea de tiempo). */
  buscar(t: number): void;
  tiempo(): number;
  /** Avisa cada vez que cambia el tiempo. Devuelve la función para dejar de escuchar. */
  suscribir(f: (t: number) => void): () => void;
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
export const Vista = forwardRef<
  VistaRef,
  { proyecto: Proyecto; ancho: number; altoMaximo: number; zonaSegura?: boolean; onReproduciendo?: (si: boolean) => void }
>(function Vista({ proyecto, ancho: anchoDisponible, altoMaximo, zonaSegura, onReproduciendo }, ref) {
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

  const [t, setTEstado] = useState(0);
  const tActual = useRef(0);
  const oyentes = useRef(new Set<(t: number) => void>());
  const setT = useCallback((v: number) => {
    tActual.current = v;
    setTEstado(v);
    oyentes.current.forEach((f) => f(v));
  }, []);

  const [tocando, setTocandoEstado] = useState(false);
  const setTocando = useCallback(
    (v: boolean) => {
      setTocandoEstado(v);
      onReproduciendo?.(v);
    },
    [onReproduciendo],
  );
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
    [tramos, uriDeTramo, player, musica, proyecto.musica, setT],
  );

  const pausar = useCallback(() => {
    generacion.current++;
    ocupado.current = false;
    player.pause();
    musica.pause();
    setTocando(false);
  }, [player, musica, setTocando]);

  // Al arrastrar llegan muchas búsquedas: se hace una a la vez y siempre la última.
  const pendiente = useRef<number | null>(null);
  const buscando = useRef(false);
  const buscar = useCallback(
    (v: number) => {
      if (!Number.isFinite(v)) return;
      const x = Math.min(Math.max(0, v), Math.max(0, total - 0.01));
      if (tocando) pausar();
      setT(x);
      pendiente.current = x;
      if (buscando.current) return;
      buscando.current = true;
      void (async () => {
        try {
          while (pendiente.current !== null) {
            const siguiente = pendiente.current;
            pendiente.current = null;
            await irA(siguiente, false);
          }
        } finally {
          buscando.current = false;
        }
      })();
    },
    [total, tocando, pausar, setT, irA],
  );

  const alternar = useCallback(() => {
    if (tocando) return pausar();
    setTocando(true);
    irA(tActual.current >= total - 0.05 ? 0 : tActual.current, true);
  }, [tocando, pausar, setTocando, irA, total]);

  useImperativeHandle(
    ref,
    () => ({
      pausar,
      alternar,
      buscar,
      tiempo: () => tActual.current,
      suscribir: (f) => {
        oyentes.current.add(f);
        return () => oyentes.current.delete(f);
      },
    }),
    [pausar, alternar, buscar],
  );

  // Si el montaje cambia, se vuelve a cargar donde iba (o al final si se acortó).
  useEffect(() => {
    pausar();
    irA(Math.min(tActual.current, Math.max(0, total - 0.05)), false);
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
  }, [tocando, tramos, inicios, player, total, irA, pausar, setT]);

  return (
    <Pressable
      onPress={alternar}
      accessibilityRole="button"
      accessibilityLabel={tocando ? 'Pausar' : 'Reproducir'}
      style={{ width: ancho, height: alto, backgroundColor: '#000', borderRadius: 14, overflow: 'hidden', alignSelf: 'center' }}
    >
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <CapaTextos textos={proyecto.textos} subtitulos={subtitulos} t={t} ancho={ancho} alto={alto} />
      {zonaSegura && <ZonaSegura vertical={proyecto.formato === '9:16'} />}
      {!tocando && (
        <View style={s.play} pointerEvents="none">
          <View style={s.playCirculo}>
            <Icono nombre="play" tamano={26} color="#FFFFFF" />
          </View>
        </View>
      )}
    </Pressable>
  );
});

/**
 * Zona segura: fuera del recuadro, los botones de Reels y TikTok tapan el video (aproximado).
 * Mismas medidas que la app de computador.
 */
function ZonaSegura({ vertical }: { vertical: boolean }) {
  const m = vertical ? { top: '12%', right: '16%', bottom: '22%', left: '6%' } : { top: '5%', right: '5%', bottom: '5%', left: '5%' };
  const sombra = 'rgba(0,0,0,0.38)';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: m.top, backgroundColor: sombra }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.bottom, backgroundColor: sombra }} />
      <View style={{ position: 'absolute', left: 0, top: m.top, bottom: m.bottom, width: m.left, backgroundColor: sombra }} />
      <View style={{ position: 'absolute', right: 0, top: m.top, bottom: m.bottom, width: m.right, backgroundColor: sombra }} />
      <View style={[{ position: 'absolute', ...m }, s.zona]} />
    </View>
  );
}

const s = StyleSheet.create({
  play: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playCirculo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  zona: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,214,10,0.85)' },
});
