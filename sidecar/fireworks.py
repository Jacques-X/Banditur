"""
Murtali (fireworks) sound analysis for Banditur.

Invoked through the transcription sidecar (one-shot processes, no Whisper model):
  transcribe --fireworks <job.json>         job: {"path": "/in.mp4"}
  transcribe --fireworks-thumbs <job.json>  job: {"path": "/in.mp4", "times": [12.5, ...], "dir": "/cache/x"}

Only the AUDIO track is decoded (one ffmpeg pass, 16 kHz mono) and measured per 0.1 s:
  rms        loudness, 0-255 (-60..0 dBFS)
  transient  onset strength (half-wave-rectified spectral flux), 0-255, relative to the
             clip's own 99th percentile: bangs and crackle are impulsive, music/crowd are not
  low        share of the energy below 150 Hz, 0-255: shell bursts and launch thumps
The decisions (segments, padding, sensitivity) are made in JavaScript, so a setting
changes instantly without another analysis.

Stdout protocol (newline-delimited JSON):
  {"type": "status",   "message": "..."}
  {"type": "progress", "value": 0-100}
  {"type": "done", "duration", "fps", "width", "height", "rate": 10,
   "rms": [...], "transient": [...], "low": [...], "peaks": [...], "peaks_rate": 50}
  {"type": "done", "files": [...]}                (thumbs)
  {"type": "error",    "message": "..."}
  {"type": "cancelled"}

Writing "cancel" to stdin (or closing stdin) stops ffmpeg.
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

from subtitle_render import probe, _watch_stdin

RATE = 16000
CURVE_RATE = 10                 # values per second
BIN = RATE // CURVE_RATE        # samples per curve value
WIN = 1024
HOP = BIN // 4
LOW_HZ = 150
BLOCK_FRAMES = 4000             # STFT frames per block (bounds memory)

NO_AUDIO = "Dan il-video m'għandux ħoss."


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def features(samples, rate=RATE):
    """Curves (lists of ints 0-255, one per 0.1 s) from mono int16 samples."""
    import numpy as np

    x = np.asarray(samples, dtype=np.int16)
    n = len(x)
    bin_len = rate // CURVE_RATE
    hop = bin_len // 4
    nbins = int(math.ceil(n / bin_len)) if n else 0
    if nbins == 0:
        return {"rms": [], "transient": [], "low": []}

    # loudness
    pad = nbins * bin_len - n
    xf = x.astype(np.float64) / 32768.0
    padded = np.concatenate([xf, np.zeros(pad)]) if pad else xf
    rms = np.sqrt(np.mean(padded.reshape(nbins, bin_len) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-6))
    rms_c = np.clip((db + 60.0) / 60.0 * 255.0, 0, 255)

    # spectral flux + low-band share, block by block
    flux_bin = np.zeros(nbins)
    low_e = np.zeros(nbins)
    tot_e = np.zeros(nbins)
    if n >= WIN:
        window = np.hanning(WIN)
        low_bins = max(1, int(LOW_HZ * WIN / rate))
        nframes = (n - WIN) // hop + 1
        prev = None
        k0 = 0
        while k0 < nframes:
            k1 = min(nframes, k0 + BLOCK_FRAMES)
            idx = (np.arange(k0, k1) * hop)[:, None] + np.arange(WIN)[None, :]
            frames = xf[idx] * window
            mag = np.abs(np.fft.rfft(frames, axis=1))
            ref = np.vstack([prev[None, :], mag[:-1]]) if prev is not None else np.vstack([mag[:1], mag[:-1]])
            flux = np.maximum(mag - ref, 0).sum(axis=1)
            power = mag ** 2
            lo = power[:, :low_bins].sum(axis=1)
            tot = power.sum(axis=1)
            # a frame belongs to the 0.1 s bin where its window ENDS (the onset enters there)
            b = np.minimum(((np.arange(k0, k1) * hop + WIN - 1) // bin_len).astype(int), nbins - 1)
            np.maximum.at(flux_bin, b, flux)
            np.add.at(low_e, b, lo)
            np.add.at(tot_e, b, tot)
            prev = mag[-1]
            k0 = k1
    p99 = float(np.percentile(flux_bin, 99)) if nbins else 0.0
    trans = np.clip(flux_bin / p99 * 255.0, 0, 255) if p99 > 0 else np.zeros(nbins)
    low = np.where(tot_e > 0, low_e / np.maximum(tot_e, 1e-12), 0) * 255.0
    return {
        "rms": np.rint(rms_c).astype(int).tolist(),
        "transient": np.rint(trans).astype(int).tolist(),
        "low": np.rint(np.clip(low, 0, 255)).astype(int).tolist(),
    }


def has_audio(ffmpeg, path):
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace")
    return bool(re.search(r"Stream #.*Audio:", r.stderr))


def analyse(path, find_ffmpeg, emit=_emit, cancelled=None):
    """Decode the audio and measure it. Returns the `done` event dict, or None if cancelled."""
    import numpy as np
    from peaks import _peaks, PEAKS_PER_SEC

    cancelled = cancelled or threading.Event()
    ffmpeg = find_ffmpeg()
    emit({"type": "status", "message": "Qed naqra l-ħoss…"})
    dur, w, h, fps = probe(ffmpeg, path)
    if not has_audio(ffmpeg, path):
        raise RuntimeError(NO_AUDIO)
    proc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    threading.Thread(target=_watch_stdin, args=(proc, cancelled), daemon=True).start()
    chunks = []
    total = 0
    last = -1
    while True:
        buf = proc.stdout.read(1 << 20)
        if not buf:
            break
        chunks.append(buf)
        total += len(buf)
        if dur > 0:
            pct = max(0, min(95, int(total / 2 / RATE / dur * 95)))
            if pct != last:
                last = pct
                emit({"type": "progress", "value": pct})
    proc.wait()
    if cancelled.is_set():
        return None
    data = b"".join(chunks)
    data = data[: len(data) // 2 * 2]
    if not data:
        raise RuntimeError(NO_AUDIO)
    samples = np.frombuffer(data, dtype="<i2")
    emit({"type": "status", "message": "Qed nikkalkola…"})
    curves = features(samples, RATE)
    peaks = _peaks(data, RATE)
    if not dur:
        dur = len(samples) / RATE
    out = {"type": "done", "duration": round(dur, 3), "fps": fps, "width": w, "height": h,
           "rate": CURVE_RATE, "peaks_rate": PEAKS_PER_SEC, "peaks": peaks}
    out.update(curves)
    return out


def run_fireworks(job_path, find_ffmpeg):
    try:
        with open(job_path, encoding="utf-8") as f:
            job = json.load(f)
        path = job.get("path")
        if not path or not os.path.isfile(path):
            raise RuntimeError(f"Fajl ma nstabx: {path}")
        cancelled = threading.Event()
        result = analyse(path, find_ffmpeg, _emit, cancelled)
        if result is None:
            _emit({"type": "cancelled"})
        else:
            _emit({"type": "progress", "value": 100})
            _emit(result)
        return 0
    except Exception as exc:
        _emit({"type": "error", "message": str(exc).splitlines()[0] if str(exc) else type(exc).__name__})
        return 0
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass


def run_thumbs(job_path, find_ffmpeg):
    """One JPEG (480 px wide) per requested time, fast-seeked, written to job['dir']/<i>.jpg."""
    try:
        with open(job_path, encoding="utf-8") as f:
            job = json.load(f)
        path, times, out_dir = job.get("path"), job.get("times") or [], job.get("dir")
        if not path or not os.path.isfile(path) or not out_dir:
            raise RuntimeError("Job invalidu.")
        os.makedirs(out_dir, exist_ok=True)
        ffmpeg = find_ffmpeg()
        import lut as lutmod
        work = tempfile.mkdtemp(prefix="banditur-thumbs-")
        staged = lutmod.stage(job.get("lut"), work)
        pre = lutmod.chain(staged, "t")
        vf = (pre + "," if pre else "") + "scale=480:-2"
        files = []
        for i, t in enumerate(times):
            dest = os.path.join(out_dir, f"{i}.jpg")
            subprocess.run(
                [ffmpeg, "-y", "-v", "error", "-ss", f"{max(0.0, float(t)):.3f}", "-i", path, "-frames:v", "1",
                 "-vf", vf, "-q:v", "4", dest],
                stdin=subprocess.DEVNULL, capture_output=True,
            )
            files.append(dest if os.path.isfile(dest) else None)
            _emit({"type": "progress", "value": int((i + 1) / max(1, len(times)) * 100)})
        shutil.rmtree(work, ignore_errors=True)
        _emit({"type": "done", "files": files})
        return 0
    except Exception as exc:
        _emit({"type": "error", "message": str(exc).splitlines()[0] if str(exc) else type(exc).__name__})
        return 0
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass
