# Editor de Video: app de iPhone (app-test-movil)

Editor rápido con IA para iPhone (Expo SDK 58, React Native 0.88, TypeScript). Uso interno: se instala con EAS (distribución interna o TestFlight), no va a la App Store. La visión general está en `../CLAUDE.md`. Lee también `AGENTS.md`: Expo cambia en cada versión, así que consulta la documentación de la v58 antes de usar una API.

## Cómo se usa

1. Nuevo video: eliges los clips de la galería, escribes qué video quieres y eliges formato, duración y música.
2. La app copia los clips y transcribe la voz en el iPhone. Luego Claude mira fotos de cada clip y arma el borrador: cortes, textos animados, subtítulos y el texto para publicar.
3. En el editor está la vista previa y cuatro pestañas:
   - IA: chat y atajos para pedir cambios.
   - Cortes: ajustar, mover y quitar tramos.
   - Textos: editar textos, estilos, animaciones y colores.
   - Más: subtítulos, sonido, música, formato y el texto para publicar.
   También hay un botón Deshacer.
4. Exportar arma el mp4 en el iPhone, lo guarda en Fotos y permite compartirlo.

## Comandos (dentro de `app-test-movil/`)

- `npm test`: pruebas del código puro (`src/lib/proyecto.ts`, `src/lib/estilos.ts`).
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
- `src/componentes/Vista.tsx`: vista previa. Un solo reproductor encadena los tramos y `CapaTextos.tsx` dibuja encima textos y subtítulos.
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

## Estado (2026-10-28)

Hecho:
- La app completa en TypeScript. Typecheck, 7 pruebas, empaquetado de Metro, `expo-doctor` (20/20) y `prebuild` de iOS, todo en verde.
- El exportador de Swift probado en el Mac: textos, subtítulos, cover y rotación verificados en fotogramas.

Pendiente:
- La primera compilación en EAS. Nunca se ha compilado el Swift con ExpoModulesCore ni se ha probado en un iPhone real.
- Probar la transcripción real y la llamada a Claude con una clave.
- Ícono y pantalla de inicio propios: hoy son los de la plantilla de Expo.
