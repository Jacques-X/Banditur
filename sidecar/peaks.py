"""
Waveform peaks for the Traskrittura timeline.

  peaks_from_wav(path)            — 16-bit mono WAV (the temp file transcription uses)
  run_peaks(media, find_ffmpeg)   — `transcribe --peaks <media>`: decodes any media
                                    with ffmpeg and prints one JSON line:
                                    {"type": "peaks", "rate": 50, "peaks": [0-255, ...]}

Each value is the loudest sample in a 1/50 s window, scaled to 0–255.
"""

import array
import json
import subprocess
import sys
import wave

PEAKS_PER_SEC = 50


def _peaks(samples, rate):
    win = max(1, rate // PEAKS_PER_SEC)
    try:
        import numpy as np
        a = np.frombuffer(samples, dtype="<i2").astype(np.int32)
        n = len(a) // win
        if n == 0:
            return []
        a = np.abs(a[: n * win]).reshape(n, win).max(axis=1)
        return (np.minimum(a, 32767) * 255 // 32767).astype(int).tolist()
    except ImportError:
        arr = array.array("h")
        arr.frombytes(samples[: len(samples) // 2 * 2])
        if sys.byteorder == "big":
            arr.byteswap()
        out = []
        for i in range(0, len(arr) - win + 1, win):
            chunk = arr[i:i + win]
            out.append(min(255, max(max(chunk), -min(chunk)) * 255 // 32767))
        return out


def peaks_from_wav(path):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            return []
        return _peaks(w.readframes(w.getnframes()), w.getframerate())


def run_peaks(media_path, find_ffmpeg):
    rate = 8000
    try:
        r = subprocess.run(
            [find_ffmpeg(), "-v", "error", "-i", media_path, "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
            capture_output=True,
        )
        if r.returncode != 0:
            raise RuntimeError(r.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or "ffmpeg failed")
        print(json.dumps({"type": "peaks", "rate": PEAKS_PER_SEC, "peaks": _peaks(r.stdout, rate)}), flush=True)
    except Exception as exc:
        print(json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False), flush=True)
    return 0
