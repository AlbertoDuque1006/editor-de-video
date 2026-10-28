# Editor de Video: app de computador (app-test-pc)

App de escritorio para Mac y Windows (Electron + React + TypeScript) para editar los videos de la empresa, con IA. Uso interno: no se publica en tiendas, se reparte el instalador. La visión general del repositorio está en `../CLAUDE.md`. Todos los comandos se corren dentro de `app-test-pc/`.

## Comandos

- `npm run dev`: abre la app en modo desarrollo.
- `node --test "tests/*.test.ts"`: pruebas (Node 24+, sin compilar).
- `npm run build`: compila a `out/`.
- `npm run dist:mac`: genera `dist/Editor de Video-<versión>-arm64.dmg`.
- `npm run dist:win`: genera el `.exe`. Hazlo solo en Windows o en GitHub Actions: `ffmpeg-static`, `sharp` y `onnxruntime` instalan binarios del sistema donde se corre `npm install`, así que hecho desde Mac el instalador sale pero la app falla.
- GitHub Actions (`.github/workflows/instaladores.yml`) genera el `.exe` y el `.dmg` en cada push a `master` o a mano. Se descargan en Actions > ejecución > Artifacts.

## Cómo está armado

- `src/main/`: proceso principal. `claude.ts` lanza Claude Code (`claude -p`) con la sesión del usuario: no usa clave de API. `aiPrompt.ts` arma las instrucciones de la IA. `transcribe.ts` y `transcriber.ts` corren Whisper local con onnxruntime; el modelo se descarga la primera vez. `export.ts` y `audioMix.ts` exportan con FFmpeg. `projectFile.ts` guarda y abre proyectos.
- `src/renderer/`: interfaz React. `Wizard.tsx` es el asistente de inicio, `AiPanel.tsx` el chat y los botones de IA, `Timeline.tsx` la línea de tiempo con varias pistas, `engine/` hace la composición, las animaciones y la reproducción.
- Diseño (desde 2026-10-28): estilo Mac oscuro, como Final Cut. Los colores, tamaños y controles están en variables al inicio de `styles.css` (azul = color de resalte del sistema, amarillo = selección, rojo = cursor de reproducción). Los íconos son SVG propios en `Icon.tsx` (al estilo SF Symbols): no uses emojis como íconos. `Shortcuts.tsx` es la ventana de atajos (Ayuda > Atajos, ⌘/); si agregas un atajo, ponlo también ahí. Para revisar el diseño se usó la skill `macos-design-guidelines`.
- Ventana: en Mac usa `hiddenInset` con translucidez (`vibrancy`) y los botones de la ventana dentro de la barra; en Windows `titleBarOverlay`. Los menús contextuales y la confirmación de descartar cambios son nativos (`menu:context` y `dialog:confirm` en `main/index.ts`). La ventana recuerda su tamaño en `ventana.json`; la interfaz recuerda los paneles abiertos y el alto de la línea de tiempo en `localStorage`.
- `src/shared/`: el contrato de datos (`types.ts`, `project.ts`), las órdenes de edición que devuelve la IA (`ops.ts`) y los cortes de silencio (`cuts.ts`). Solo tiene código puro, que es el que tiene pruebas.

## Decisiones de seguridad (no revertir)

- En Windows solo se lanza `claude.exe`, nunca `.cmd` ni con `shell: true`, para evitar que se inyecten órdenes por la línea de comandos.
- Se rechazan las rutas de red (`\\servidor\...`) al abrir proyectos o importar archivos, para no filtrar credenciales NTLM.

## Estado (2026-10-28)

Hecho: versión 1 (editor básico), versión 2 (asistente de inicio, chat con Claude, animaciones y keyframes, varias pistas, subtítulos y quitar silencios con Whisper, textos para redes), correcciones de seguridad y `.dmg` regenerado y probado en el Mac. Rediseño estilo Mac (2026-10-28): barra unificada, paneles que se ocultan, línea de tiempo con alto ajustable y zoom con ⌘ + rueda, menús contextuales, atajos y exportación probados en desarrollo.

Pendiente:
- Comprobar que el `.exe` de GitHub Actions funciona en un PC con Windows.
- Firmar y notarizar en Mac: no hay certificado "Developer ID Application" instalado. Hay que crearlo en la cuenta de Apple Developer, instalarlo en el Llavero y configurar la notarización en `electron-builder.yml`. Si se firma en Actions, van como secretos `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID`.
- El ícono propio está en `build/icon.svg` → `build/icon.png` (1024 px, colores de la marca); electron-builder saca de ahí el de Mac y el de Windows. Falta verlo en un `.dmg` y un `.exe` nuevos.
- La versión para iPhone es otra app: `../app-test-movil`.
