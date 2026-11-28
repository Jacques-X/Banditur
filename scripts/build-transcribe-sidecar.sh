#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/venv/bin/python"
MODEL_DIR="$ROOT/mlx-maltese-whisper-4bit"
OUTPUT_DIR="$ROOT/sidecar-dist/transcribe-bundle"

SETUP='python3.13 -m venv venv && venv/bin/python -m pip install -r sidecar/requirements.txt pyinstaller'

if [[ ! -x "$PYTHON" ]]; then
  echo "Missing Python environment: $PYTHON" >&2
  echo "Run: npm run build:local (it finds or installs Python 3.10-3.13 and creates the venv), or: $SETUP" >&2
  exit 1
fi

if [[ ! -f "$MODEL_DIR/config.json" || ! -f "$MODEL_DIR/weights.safetensors" ]]; then
  echo "Missing bundled transcription model in: $MODEL_DIR" >&2
  exit 1
fi

if ! "$PYTHON" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)'; then
  echo "The venv uses Python $("$PYTHON" -c 'import platform; print(platform.python_version())'); Banditur needs 3.10 to 3.13 (onnxruntime and MLX have no wheels for newer ones)." >&2
  echo "Run: npm run build:local (it recreates the venv with a supported Python), or: rm -rf venv && $SETUP" >&2
  exit 1
fi

if ! "$PYTHON" -c 'import PyInstaller, imageio_ffmpeg, mlx_whisper, onnxruntime, numpy' 2>/dev/null; then
  echo "The venv is missing packages the engine needs (PyInstaller, mlx-whisper, imageio-ffmpeg, onnxruntime or numpy)." >&2
  echo "Run: npm run build:local (it repairs the venv), or: venv/bin/python -m pip install -r sidecar/requirements.txt pyinstaller" >&2
  exit 1
fi

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
# The extension's name carries the venv's Python version (core.cpython-313-darwin.so,
# core.cpython-314-darwin.so, …), so find it rather than assuming one.
shopt -s nullglob
MLX_CORES=("$OUTPUT_DIR"/_internal/mlx/core.cpython-*-darwin.so)
shopt -u nullglob
if [[ ${#MLX_CORES[@]} -ne 1 ]]; then
  echo "Expected one MLX core library (core.cpython-*-darwin.so), found ${#MLX_CORES[@]}." >&2
  exit 1
fi
MLX_CORE="${MLX_CORES[0]}"
MLX_LIB="$OUTPUT_DIR/_internal/mlx/lib/libmlx.dylib"
install_name_tool -rpath '@loader_path/..' '@loader_path/lib' "$MLX_CORE"
install_name_tool -rpath '@loader_path/../..' '@loader_path' "$MLX_LIB"
codesign --force --sign - "$MLX_CORE" "$MLX_LIB"
rm -f "$OUTPUT_DIR/_internal/libmlx.dylib" "$OUTPUT_DIR/_internal/libjaccl.dylib"

if [[ -e "$OUTPUT_DIR/_internal/torch" || -e "$OUTPUT_DIR/_internal/scipy" || -e "$OUTPUT_DIR/_internal/hf_xet" \
  || -e "$OUTPUT_DIR/_internal/transformers" || -e "$OUTPUT_DIR/_internal/torchaudio" || -e "$OUTPUT_DIR/_internal/nltk" \
  || -e "$OUTPUT_DIR/_internal/ctc_forced_aligner" || -e "$OUTPUT_DIR/_internal/tokenizers" ]]; then
  echo "Transcription sidecar contains an excluded heavyweight package." >&2
  exit 1
fi

if ! find "$OUTPUT_DIR" -type f -name 'ffmpeg-*' -perm -111 | grep -q .; then
  echo "Transcription sidecar is missing its bundled ffmpeg executable." >&2
  exit 1
fi
