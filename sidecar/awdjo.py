"""
Awdjo: clean the speech in a video's sound with NVIDIA NemotronLabs RE-USE (MLX), for Banditur.

Invoked through the transcription sidecar (one process per file, no Whisper model):
  transcribe --awdjo <job.json>
  job: {"path": "/in.mov", "output": "/in (nadif).mov", "model_dir": "/…/models/nemotron-reuse", "strength": 0.0-1.0}

What it does: reads the FIRST audio stream with ffmpeg (one channel at a time, at the file's own rate when the
model supports it, else 48 kHz), enhances each channel in overlapping chunks (awdjo_chunks.py), blends with the
original by `strength` (1 = fully enhanced), and writes a NEW file: the picture is copied untouched (-c:v copy),
the sound is replaced (MOV/MXF/WAV → PCM 24-bit, MP4/M4V → AAC 320 kbps). The original is never touched, an
existing output is never overwritten, and the sound has exactly the original's number of samples.
Other audio streams, subtitles and data tracks are not copied.

Stdout protocol (newline-delimited JSON), as in fireworks_render:
  {"type": "status", "message": "..."}   {"type": "progress", "value": 0-100}
  {"type": "done", "path", "rate", "channels", "seconds"}   {"type": "error", "message"}   {"type": "cancelled"}
Writing "cancel" to stdin (or closing stdin) stops it.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

import numpy as np

import awdjo_chunks as ch

NO_AUDIO = "Dan il-fajl m'għandux ħoss."
NO_MODEL = "Il-model tal-Awdjo mhux imniżżel (Settings → Components)."

# output extension → (ffmpeg muxer, audio codec args). The MP4 family cannot carry PCM reliably, so it gets AAC.
AUDIO_OUT = {
    "mov": ("mov", ["-c:a", "pcm_s24le"]),
    "mxf": ("mxf", ["-c:a", "pcm_s24le"]),
    "wav": ("wav", ["-c:a", "pcm_s24le"]),
    "mp4": ("mp4", ["-c:a", "aac", "-b:a", "320k"]),
    "m4v": ("mp4", ["-c:a", "aac", "-b:a", "320k"]),
}


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def _status(msg):
    _emit({"type": "status", "message": msg})


def _progress(v):
    _emit({"type": "progress", "value": max(0, min(100, int(v)))})


def inspect_text(info):
    """Facts from `ffmpeg -i` output (stderr): rate, channels, whether there is a real picture, the start offset."""
    audio = None
    has_video = False
    for line in info.splitlines():
        if "Stream #" not in line:
            continue
        if audio is None and "Audio:" in line:
            m = re.search(r"Audio:[^\n]*?,\s*(\d+)\s*Hz,\s*([^,\n]+)", line)
            if m:
                audio = {"rate": int(m.group(1)), "layout": m.group(2).strip(), "channels": ch.channels_of(m.group(2))}
        elif "Video:" in line and "attached pic" not in line:
            has_video = True
    start = 0.0
    sm = re.search(r"Duration:[^\n]*?start:\s*(-?\d+(?:\.\d+)?)", info)
    if sm:
        start = float(sm.group(1))
    return {"audio": audio, "has_video": has_video, "start": start}


def mux_args(ffmpeg, src, raw, rate, channels, out_tmp, ext, has_video, offset=0.0):
    """The ffmpeg command writing the new file: picture copied from `src`, sound from the raw float file."""
    fmt, codec = AUDIO_OUT[ext]
    cmd = [ffmpeg, "-y", "-hide_banner", "-v", "error", "-nostdin", "-nostats", "-progress", "pipe:1", "-i", src]
    if offset > 0.0005:
        cmd += ["-itsoffset", f"{offset:.6f}"]
    cmd += ["-f", "f32le", "-ar", str(rate), "-ac", str(channels), "-i", raw]
    if has_video and ext != "wav":
        cmd += ["-map", "0:v", "-c:v", "copy"]
    else:
        cmd += ["-vn"]
    cmd += ["-map", "1:a"] + codec + ["-ar", str(rate)]
    cmd += ["-dn", "-sn", "-map_metadata", "0", "-map_metadata:s:a:0", "0:s:a:0", "-map_chapters", "0"]
    if fmt in ("mov", "mp4"):
        cmd += ["-movflags", "+use_metadata_tags" + ("+faststart" if fmt == "mp4" else "")]
    cmd += ["-f", fmt, out_tmp]
    return cmd


class Stop(Exception):
    pass


class MlxEnhancer:
    """Adapts the MLX model to numpy in / numpy out (the tests swap in plain stand-ins with the same method)."""

    def __init__(self, model, mx):
        self.model, self.mx = model, mx

    def enhance_chunk(self, clip, rate):
        r = self.model.enhance_chunk(self.mx.array(clip), rate)
        self.mx.eval(r)
        return np.array(r)


class Job:
    def __init__(self):
        self.cancel = threading.Event()
        self.proc = None

    def watch_stdin(self):
        def loop():
            try:
                for line in sys.stdin:
                    if line.strip().lower() == "cancel":
                        break
            except Exception:
                pass
            self.cancel.set()
            p = self.proc
            if p is not None and p.poll() is None:
                p.terminate()
        threading.Thread(target=loop, daemon=True).start()

    def check(self):
        if self.cancel.is_set():
            raise Stop()


def decode_channel(ffmpeg, path, index, channels, rate, job):
    """One channel of the first audio stream as float32 at `rate`."""
    cmd = [ffmpeg, "-v", "error", "-nostdin", "-i", path, "-map", "0:a:0", "-vn", "-sn", "-dn"]
    if channels > 1:
        cmd += ["-af", f"pan=mono|c0=c{index}"]
    cmd += ["-ac", "1", "-ar", str(rate), "-f", "f32le", "pipe:1"]
    job.proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = job.proc.communicate()
    code = job.proc.returncode
    job.proc = None
    job.check()
    if code != 0 or not out:
        tail = err.decode(errors="replace").strip().splitlines()
        raise RuntimeError("Ma stajtx naqra l-ħoss: " + (tail[-1] if tail else "ffmpeg"))
    return np.frombuffer(out[: len(out) // 4 * 4], dtype="<f4").astype(np.float32, copy=True)


def run_mux(cmd, total_seconds, job, lo=90, hi=99):
    job.proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    err_lines = []
    t_err = threading.Thread(target=lambda: err_lines.extend(job.proc.stderr.read().splitlines()), daemon=True)
    t_err.start()
    last = -1
    for line in job.proc.stdout:
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            try:
                secs = int(line.split("=")[1]) / 1_000_000
            except ValueError:
                continue
            if total_seconds > 0:
                v = lo + int((hi - lo) * min(1.0, secs / total_seconds))
                if v != last:
                    last = v
                    _progress(v)
    code = job.proc.wait()
    t_err.join(timeout=2)
    job.proc.stdout.close()
    job.proc.stderr.close()
    job.proc = None
    job.check()
    if code != 0:
        tail = [l for l in err_lines if l.strip()]
        raise RuntimeError("Ma stajtx nikteb il-fajl ġdid: " + (tail[-1] if tail else f"ffmpeg {code}"))


def process(job_data, find_ffmpeg, job, model=None, workdir=None):
    """Run one file. Returns the result dict. `model` (an object with .enhance_chunk) is swapped in by the tests."""
    t0 = time.time()
    path, output = job_data["path"], job_data["output"]
    strength = float(job_data.get("strength", 1.0))
    if not os.path.isfile(path):
        raise RuntimeError("Il-fajl ma nstabx.")
    if os.path.abspath(path) == os.path.abspath(output):
        raise RuntimeError("Ma nistax nikteb fuq il-fajl oriġinali.")
    if os.path.exists(output):
        raise RuntimeError("Il-fajl tal-output diġà jeżisti.")
    ext = os.path.splitext(output)[1].lstrip(".").lower()
    if ext not in AUDIO_OUT:
        raise RuntimeError("Format tal-output mhux appoġġat.")
    ffmpeg = find_ffmpeg()
    info = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace").stderr
    facts = inspect_text(info)
    audio = facts["audio"]
    if not audio:
        raise RuntimeError(NO_AUDIO)
    channels = audio["channels"] or 2
    rate = ch.working_rate(audio["rate"], "mxf" if ext == "mxf" else "")
    dur_m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
    total_seconds = int(dur_m.group(1)) * 3600 + int(dur_m.group(2)) * 60 + float(dur_m.group(3)) if dur_m else 0.0

    if model is None:
        model_dir = job_data.get("model_dir") or ""
        if not (os.path.isfile(os.path.join(model_dir, "model.safetensors")) and os.path.isfile(os.path.join(model_dir, "config.json"))):
            raise RuntimeError(NO_MODEL)
        try:
            import mlx.core as mx
            from reuse_mlx import load_model
        except ImportError:
            raise RuntimeError("L-engine ma jinkludix MLX. Aġġorna l-engine (Settings → Components).")
        _status("Qed intella' l-model…")
        model = MlxEnhancer(load_model(model_dir), mx)

    def enhance_one(clip):
        return model.enhance_chunk(clip, rate)

    own = workdir is None
    work = workdir or tempfile.mkdtemp(prefix="banditur-awdjo-")
    tmp_out = output + ".partial"
    try:
        raw_path = os.path.join(work, "clean.f32")
        raw = None
        n = None
        done_chunks = 0
        total_chunks = None
        for c in range(channels):
            job.check()
            _status("Qed naqra l-ħoss…" if channels == 1 else f"Qed naqra l-ħoss (kanal {c + 1}/{channels})…")
            dry = decode_channel(ffmpeg, path, c, channels, rate, job)
            if n is None:
                n = len(dry)
                if n == 0:
                    raise RuntimeError(NO_AUDIO)
                total_chunks = ch.chunk_count(n, rate, channels)
                raw = np.memmap(raw_path, dtype="<f4", mode="w+", shape=(n, channels))
            dry = ch.fit_length(dry, n)
            _status("Qed innaddaf il-ħoss…" if channels == 1 else f"Qed innaddaf il-ħoss (kanal {c + 1}/{channels})…")

            def on_chunk(i, k, base=done_chunks):
                _progress(5 + 85 * (base + i) / max(1, total_chunks))

            wet = ch.enhance_channel(dry, rate, enhance_one, on_chunk=on_chunk, cancelled=job.cancel.is_set)
            if wet is None:
                raise Stop()
            if not np.isfinite(wet).all():
                raise RuntimeError("Il-model tal-Awdjo ta riżultat invalidu.")
            done_chunks += len(ch.plan_chunks(n, rate)[1])
            raw[:, c] = ch.mix(dry, ch.fit_length(wet, n), strength)
            del dry, wet
        raw.flush()
        del raw
        job.check()
        _status("Qed nikteb il-fajl ġdid…")
        _progress(90)
        offset = facts["start"] if facts["start"] > 0 else 0.0
        run_mux(mux_args(ffmpeg, path, raw_path, rate, channels, tmp_out, ext, facts["has_video"], offset), total_seconds, job)
        if os.path.exists(output):
            raise RuntimeError("Il-fajl tal-output diġà jeżisti.")
        os.rename(tmp_out, output)
        return {"path": output, "rate": rate, "channels": channels, "samples": int(n), "seconds": round(time.time() - t0, 1)}
    finally:
        if os.path.exists(tmp_out):
            try:
                os.remove(tmp_out)
            except OSError:
                pass
        if own:
            shutil.rmtree(work, ignore_errors=True)


def run_awdjo(job_path, find_ffmpeg):
    try:
        with open(job_path, encoding="utf-8") as f:
            data = json.load(f)
        if not data.get("path") or not data.get("output"):
            raise RuntimeError("Job invalidu.")
        job = Job()
        job.watch_stdin()
        _progress(0)
        res = process(data, find_ffmpeg, job)
        _progress(100)
        _emit({"type": "done", **res})
        return 0
    except Stop:
        _emit({"type": "cancelled"})
        return 0
    except Exception as exc:
        text = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        _emit({"type": "error", "message": text})
        return 0
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass
