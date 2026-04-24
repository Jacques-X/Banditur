# Pubblikatur

A desktop PR tool for photographers and videographers, built with [Tauri](https://tauri.app) (Rust + Vite). It handles three post-production tasks in one window: watermarking photos, converting RAW files, and transcribing video.

## Features

### Marka & Ssortja — Watermark & Sort
Bulk-processes a folder of JPEGs (and PNGs, TIFFs, BMPs, WebPs):
- Applies a per-photographer watermark overlay, read from `src-tauri/watermarks/<name>/portrait.png` and `landscape.png`
- Auto-detects EXIF orientation and rotates before compositing
- Sorts output into `portrett/` and `pajsaġġ/` sub-folders
- Optional compression: configurable quality (60–95%) and max dimension (1080–4096 px)
- Parallel processing via Rayon; real-time progress and per-file log

### ARW → JPG — RAW Conversion
Batch-converts Sony ARW files (also CR2, CR3, NEF, ORF, RW2, DNG, RAF):
- Extracts the full-resolution embedded JPEG preview directly from the RAW container — no demosaicing, instant output
- Falls back to a full binary scan if the TIFF IFD doesn't yield a large enough preview
- Same optional compression controls as the watermark tab

### Traskrittura — Video Transcription
Transcribes `.mp4` and `.mov` files using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (Whisper `medium` model, Apple Silicon GPU via CoreML when available):
- Drag-and-drop or click-to-pick
- Word-level timestamps; low-confidence words highlighted in red
- Inline editor — click any timestamp to jump to that moment in the video preview
- Exports to `.srt` alongside the source video; Cmd/Ctrl+S to save
- Model pre-warms in the background as soon as the tab is opened, so it's ready before the file picker closes

## Requirements

| Dependency | Purpose |
|---|---|
| Rust + Cargo | Tauri backend |
| Node.js + npm | Vite frontend |
| [cmake](https://cmake.org) | Required to build mozjpeg |
| [ffmpeg](https://ffmpeg.org) | Audio extraction for transcription |
| Python 3.10+ | Transcription sidecar |

On macOS with Homebrew:
```bash
brew install cmake ffmpeg
```

## Setup

```bash
# 1. Install JS dependencies
npm install

# 2. Create the Python venv and install faster-whisper
python3 -m venv venv
venv/bin/pip install -r sidecar/requirements.txt
```

### Adding a photographer watermark

Create a folder under `src-tauri/watermarks/` named after the photographer, containing two full-resolution PNG overlays:

```
src-tauri/watermarks/
└── Maria Borg/
    ├── portrait.png   ← composited over portrait images
    └── landscape.png  ← composited over landscape images
```

The watermark is scaled to match each image before compositing, so design it at your target output resolution.

## Development

```bash
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

The compiled app bundles the watermarks folder and the transcription sidecar wrapper. The Python venv is **not** bundled — it must exist at the project root at runtime.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `WHISPER_MODEL` | `medium` | Whisper model size: `tiny`, `base`, `small`, `medium`, `large-v3` |

## Tech stack

- **Frontend** — Vanilla JS + Vite, no framework
- **Backend** — Rust, Tauri 2
- **Image processing** — [`image`](https://crates.io/crates/image), [`mozjpeg`](https://crates.io/crates/mozjpeg), [`kamadak-exif`](https://crates.io/crates/kamadak-exif), [`rayon`](https://crates.io/crates/rayon)
- **Transcription** — [faster-whisper](https://github.com/SYSTRAN/faster-whisper) via a Python sidecar
