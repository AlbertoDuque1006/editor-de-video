# Editor de Video

Editor de video con IA para la empresa: uso interno, no se publica en tiendas.
- Repositorio: https://github.com/AlbertoDuque1006/editor-de-video (privado). Rama: `master`.
- Commits solo con la cuenta personal AlbertoDuque1006. Este repo ya tiene configurados `user.name` y `user.email` locales; nunca uses otra identidad.

## Carpetas

- `app-test-pc/`: app de computador para Mac y Windows (Electron). Es la más completa: varias pistas, keyframes y Whisper local. La IA usa Claude Code con la sesión del usuario. Ver `app-test-pc/CLAUDE.md`.
- `app-test-movil/`: app de iPhone (Expo / React Native). Es un editor rápido con IA: Claude arma el video, se ajusta con chat o a mano y se exporta en el iPhone. La IA usa la API de Claude con una clave guardada en el teléfono. Ver `app-test-movil/CLAUDE.md`.
- `.github/workflows/instaladores.yml`: genera los instaladores de computador (`.exe` y `.dmg`) cuando cambia `app-test-pc/`.

Las dos apps no comparten código: la del iPhone usa un modelo de proyecto más simple, propio.

## Forma de trabajo

Claude coordina y reparte el trabajo a Codex. Codex escribe en tareas acotadas (`codex exec -s workspace-write`) y revisa en modo solo lectura. Las tareas para Codex se escriben en `<app>/.tareas/`, que git ignora. Solo Claude hace commits.
