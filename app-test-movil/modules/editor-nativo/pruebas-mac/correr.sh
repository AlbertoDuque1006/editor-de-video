#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
FFMPEG="../../../../app-test-pc/node_modules/ffmpeg-static/ffmpeg"
mkdir -p .cache salida
export CLANG_MODULE_CACHE_PATH="$PWD/.cache"
export EDITOR_NATIVO_CACHE_DIR="$PWD/salida"

"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=1920x1080:rate=30:duration=4' \
  -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=4' \
  -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -c:a aac -shortest salida/horizontal.mp4
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=1080x1920:rate=30:duration=3' \
  -an -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p salida/vertical.mp4

swiftc -suppress-warnings -module-cache-path "$CLANG_MODULE_CACHE_PATH" ../ios/Exportador.swift main.swift -o .cache/probar
swiftc -suppress-warnings -module-cache-path "$CLANG_MODULE_CACHE_PATH" -typecheck ../ios/Exportador.swift ../ios/Transcriptor.swift
if ! .cache/probar "$PWD/salida" | tee salida/ejecucion.log; then
  .cache/probar "$PWD/salida" --diagnostico | tee salida/diagnostico.log || true
  "$FFMPEG" -hide_banner -i salida/horizontal.mp4 2>&1 | tee salida/inspeccion-horizontal.txt || true
  "$FFMPEG" -hide_banner -i salida/vertical.mp4 2>&1 | tee salida/inspeccion-vertical.txt || true
  exit 1
fi
VIDEO="$(sed -n 's/^VIDEO=//p' salida/ejecucion.log | tail -1)"
for momento in 0.7 2.0 3.8 5.0; do
  "$FFMPEG" -hide_banner -loglevel error -y -ss "$momento" -i "$VIDEO" -frames:v 1 "salida/fotograma-${momento}.png"
done
"$FFMPEG" -hide_banner -i "$VIDEO" 2>&1 | tee salida/inspeccion.txt || true
