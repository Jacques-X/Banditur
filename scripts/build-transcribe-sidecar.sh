#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/venv/bin/python"
MODEL_DIR="$ROOT/mlx-maltese-whisper-4bit"
OUTPUT_DIR="$ROOT/sidecar-dist/transcribe-bundle"

if [[ ! -x "$PYTHON" ]]; then
  echo "Missing Python environment: $PYTHON" >&2
  echo "Run: python3 -m venv venv && venv/bin/pip install -r sidecar/requirements.txt pyinstaller" >&2
  exit 1
fi

if [[ ! -f "$MODEL_DIR/config.json" || ! -f "$MODEL_DIR/weights.safetensors" ]]; then
  echo "Missing bundled transcription model in: $MODEL_DIR" >&2
  exit 1
fi

"$PYTHON" -c 'import PyInstaller, imageio_ffmpeg, mlx_whisper'

rm -rf "$OUTPUT_DIR"
cd "$ROOT"
"$PYTHON" -m PyInstaller \
  --noconfirm \
  --clean \
  --distpath "$ROOT/sidecar-dist" \
  --workpath "$ROOT/build" \
  "$ROOT/transcribe-bundle.spec"

if [[ ! -x "$OUTPUT_DIR/transcribe-bundle" ]]; then
  echo "Transcription sidecar build did not produce an executable." >&2
  exit 1
fi

MLX_METALLIB="$OUTPUT_DIR/_internal/mlx/lib/mlx.metallib"
if [[ ! -f "$MLX_METALLIB" ]]; then
  echo "Transcription sidecar is missing mlx.metallib." >&2
  exit 1
fi

# Load MLX from its real package directory. This avoids top-level compatibility
# symlinks that Tauri would otherwise expand into duplicate large files.
MLX_CORE="$OUTPUT_DIR/_internal/mlx/core.cpython-313-darwin.so"
MLX_LIB="$OUTPUT_DIR/_internal/mlx/lib/libmlx.dylib"
install_name_tool -rpath '@loader_path/..' '@loader_path/lib' "$MLX_CORE"
install_name_tool -rpath '@loader_path/../..' '@loader_path' "$MLX_LIB"
codesign --force --sign - "$MLX_CORE" "$MLX_LIB"
rm -f "$OUTPUT_DIR/_internal/libmlx.dylib" "$OUTPUT_DIR/_internal/libjaccl.dylib"

if [[ -e "$OUTPUT_DIR/_internal/torch" || -e "$OUTPUT_DIR/_internal/scipy" || -e "$OUTPUT_DIR/_internal/hf_xet" ]]; then
  echo "Transcription sidecar contains an excluded heavyweight package." >&2
  exit 1
fi

if ! find "$OUTPUT_DIR" -type f -name 'ffmpeg-*' -perm -111 | grep -q .; then
  echo "Transcription sidecar is missing its bundled ffmpeg executable." >&2
  exit 1
fi
