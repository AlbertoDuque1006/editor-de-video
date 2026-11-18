# Editor de Video con IA

Editor de video con IA hecho para el equipo de una agencia de marketing. No va a tiendas: el instalador se reparte y en el iPhone se usa EAS o TestFlight.
- Repositorio PÚBLICO desde 2026-11-17: https://github.com/AlbertoDuque1006/editor-de-video (rama `master`, licencia MIT). `README.md` es la cara pública: si cambias funciones, actualízalo, y también las capturas de `docs/capturas/`.
- Commits solo con la cuenta AlbertoDuque1006. El repo ya tiene `user.name` y `user.email` locales; nunca uses otra identidad.
- Como es público, no subas claves, nombres de clientes, enlaces a builds de EAS ni datos de cuentas. Antes de hacer push: `gitleaks git . --redact`.

## Carpetas

- `app-test-pc/`: app de computador para Mac y Windows (Electron). Es la más completa: varias pistas, keyframes y Whisper local. La IA usa Claude Code con la sesión del usuario. Ver `app-test-pc/CLAUDE.md`.
- `app-test-movil/`: app de iPhone (Expo / React Native). Es un editor rápido con IA: Claude arma el video, se ajusta con chat o a mano y se exporta en el iPhone. La IA usa la API de Claude con una clave guardada en el teléfono. Ver `app-test-movil/CLAUDE.md`.
- `.github/workflows/instaladores.yml`: genera los instaladores de computador (`.exe` y `.dmg`) cuando cambia `app-test-pc/`.
- `docs/capturas/`: capturas del README.
  - Se sacan con `npx electron-vite dev --remoteDebuggingPort 9333` y playwright `connectOverCDP`.
  - Para tener material, se importan clips de prueba hechos con FFmpeg (`gradients`, `mandelbrot`) usando `Input.dispatchDragEvent` con `files`.
  - Se guardan en JPG de 1800 px.

Las dos apps no comparten código: la del iPhone usa un modelo de proyecto más simple, propio.

## Forma de trabajo

Claude hace el trabajo y los commits. Las notas de tareas para otros agentes van en `<app>/.tareas/`, que git ignora.
