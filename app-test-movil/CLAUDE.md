# Editor de Video: app de iPhone (app-test-movil)

Editor rápido con IA para iPhone (Expo SDK 58, React Native 0.88, TypeScript). Uso interno: se instala con EAS (distribución interna o TestFlight), no va a la App Store. La visión general está en `../CLAUDE.md`. Lee también `AGENTS.md`: Expo cambia en cada versión, así que consulta la documentación de la v58 antes de usar una API.

## Cómo se usa

1. Nuevo video: eliges los clips de la galería, escribes qué video quieres y eliges formato, duración y música.
2. La app copia los clips y transcribe la voz en el iPhone. Luego Claude mira fotos de cada clip y arma el borrador: cortes, textos animados, subtítulos y el texto para publicar.
3. En el editor está la vista previa, los controles de reproducción, la línea de tiempo y cuatro pestañas:
   - Línea de tiempo al estilo de iMovie: el cursor rojo queda fijo en el centro y se desliza la tira de fotogramas. El clip que está bajo el cursor es el que se edita (marco amarillo). Debajo va una franja morada con los textos; tocar uno lo elige.
   - IA: chat y atajos para pedir cambios.
   - Cortes: dividir, "empieza aquí", "termina aquí", duplicar, mover, quitar y agregar clips (de los del proyecto o nuevos de la galería). Todo se aplica al clip bajo el cursor.
   - Textos: subtítulos automáticos, y para cada texto el estilo, la posición, la animación, el color y "empieza/termina aquí".
   - Más: texto para publicar, sonido, música, formato y nombre.
   En la barra de arriba están Deshacer, Rehacer, un menú (zona segura de Reels/TikTok, agregar clip) y Exportar.
4. Exportar arma el mp4 en el iPhone, lo guarda en Fotos y permite compartirlo.

## Comandos (dentro de `app-test-movil/`)

- `npm test`: pruebas del código puro (`src/lib/proyecto.ts`, `src/lib/montaje.ts`, `src/lib/estilos.ts`).
- `npm run typecheck`
- `npm run go`: servidor para probar en **Expo Go**. Sin el módulo nativo no exporta ni transcribe.
- `npm run dev`: servidor para la **app de desarrollo** instalada.
- `npm run build:desarrollo`: compila en la nube la app de desarrollo (perfil `desarrollo` de `eas.json`).
- `npm run build:prueba`: compila la app completa, que funciona sin el Mac (perfil `prueba`).
- `bash modules/editor-nativo/pruebas-mac/correr.sh`: prueba el exportador de Swift en el Mac. Genera clips con el FFmpeg de `app-test-pc`, exporta y saca fotogramas a `pruebas-mac/salida/`. No se puede correr dentro del sandbox de Codex, porque bloquea VideoToolbox.

No hay Xcode en el Mac: el código Swift solo se compila de verdad en EAS. `ios/` se genera con `npx expo prebuild` y git lo ignora; no lo edites a mano.

## Cómo está armado

- `src/app/`: pantallas (Expo Router).
  - `index.tsx`: lista de videos.
  - `nuevo.tsx`: crear un video.
  - `editor/[id].tsx`: el editor.
  - `ajustes.tsx`: clave de Claude e idioma.
- `src/lib/`:
  - `tipos.ts` y `proyecto.ts`: modelo y lógica pura, con pruebas. Un proyecto tiene clips, `tramos` (pedazos de clips en orden), `textos` en tiempo del video final y subtítulos que salen de la transcripción.
  - `almacen.ts`: cada proyecto en `Documentos/proyectos/<id>/`. Se guardan nombres de archivo, no rutas, porque iOS cambia la ruta de Documentos al actualizar la app.
  - `ia.ts`: llamada a Claude con `@anthropic-ai/sdk`. Usa el modelo `claude-opus-5-5`, esfuerzo `medium` para el borrador y `low` para el chat, salida estructurada con zod y `fallbacks: "default"`. Claude siempre devuelve el montaje completo y `aplicarPlan` lo valida y corrige.
  - `nativo.ts`: puente con el módulo nativo.
  - `estilos.ts`: medidas de textos, compartidas con Swift.
  - `montaje.ts`: operaciones de la línea de tiempo (dividir, quitar un rango, empieza/termina aquí, duplicar, insertar, mover), puras y con pruebas. Mueven los textos para que sigan alineados con el video.
- `src/componentes/`:
  - `Vista.tsx`: vista previa. Un solo reproductor encadena los tramos y `CapaTextos.tsx` dibuja encima textos y subtítulos. Expone `buscar`, `alternar`, `tiempo` y `suscribir`: el tiempo no está en el estado del editor para no redibujar toda la pantalla en cada fotograma (usa `useTiempo` de `Linea.tsx`).
  - `Linea.tsx`: la línea de tiempo. `paneles.tsx`: las cuatro pestañas.
  - Diseño (desde 2026-10-29), igual que la app de computador: colores del sistema de iOS en `tema.ts` (azul = resalte, amarillo = selección, rojo = cursor), SF Symbols con `Icono.tsx` (no uses emojis como íconos; si agregas uno, ponlo en `ICONOS` con su nombre de Material para web), controles en `ui.tsx` (`Boton`, `Grupo`/`Celda` como en Ajustes del iPhone, `Segmentado` nativo, `tacto` para la vibración). Los botones de la barra y los menús son nativos (`Stack.Toolbar`, `Link.Menu`): en iOS 26 salen con Liquid Glass. Se revisó con la skill `ios-design-guidelines`.
- `modules/editor-nativo/`: módulo local de Expo, solo iOS.
  - `Exportador.swift`: AVFoundation. Recorte tipo cover que respeta la rotación de los videos del iPhone, mezcla de audio y música en bucle con desvanecido al final. Los textos se pintan con CoreText en imágenes, porque `CATextLayer` sale vacío al exportar.
  - `Transcriptor.swift`: Speech, en el dispositivo si se puede.
  - El contrato con JavaScript está en `src/EditorNativoModule.ts`. En Expo Go el módulo es `null` y la app lo avisa.

**Si cambias una medida de texto, cámbiala en `src/lib/estilos.ts` y en `Exportador.swift`.** Si no, la vista previa deja de parecerse al video exportado.

## Probar en el iPhone

- **Rápido, con Expo Go:** instalas Expo Go desde la App Store, corres `npm run go` con el iPhone en la misma red Wi-Fi que el Mac y escaneas el QR con la cámara. Sirve para crear y editar con IA. No exporta ni transcribe.
- **App completa:**
  1. `npx eas-cli@latest login`, con una cuenta gratis de expo.dev.
  2. `npx eas-cli@latest device:create`: registra el iPhone. Abres el enlace en el iPhone e instalas el perfil.
  3. En el iPhone activas Ajustes → Privacidad y seguridad → Modo de desarrollador.
  4. `npm run build:prueba`: pide el Apple ID de la cuenta de desarrollador y crea los certificados solo.
  5. Abres en el iPhone el enlace o el QR que da EAS para instalar la app.
  - Con `build:desarrollo` y luego `npm run dev`, los cambios de código se ven al instante sin recompilar.
- Para otras personas de la empresa: registra su iPhone con `device:create` y recompila con `build:prueba`, o usa TestFlight (perfil `testflight` y `eas-cli submit`).

## Estado (2026-10-29)

Hecho:
- La app completa en TypeScript. Typecheck, 14 pruebas, empaquetado de Metro y `expo-doctor` (20/20), todo en verde.
- El exportador de Swift probado en el Mac: textos, subtítulos, cover y rotación verificados en fotogramas.
- Primera compilación en EAS (perfil `prueba`, build 2, 2026-10-28), instalada en el iPhone del usuario.
- Rediseño estilo iPhone (2026-10-29): ícono y pantalla de inicio propios (`assets/`, salen de `../app-test-pc/build/icon.svg`), línea de tiempo, rehacer, zona segura, portadas en la lista, menú al mantener presionado un video (cambiar nombre, duplicar, borrar). Revisado en Chrome a 390 pt con datos de muestra; falta verlo en el iPhone.

Pendiente:
- Compilar de nuevo (`npm run build:prueba`) para tener el rediseño en el iPhone: trae módulos nativos nuevos (expo-symbols, expo-haptics, @expo/ui, expo-splash-screen, expo-font), así que no sirve una actualización por aire.
- Probar en el iPhone: la barra nativa, el menú de los videos, la línea de tiempo con el dedo, la transcripción real y la llamada a Claude con una clave.
- Para revisar el diseño en el Mac sin iPhone se puede abrir en Chrome con `react-native-web` y datos de muestra, pero el SDK de Anthropic no carga en la web de desarrollo (importación circular; en iOS sí carga) y hay que cambiar `ia.ts` por uno falso solo para esa vista.
