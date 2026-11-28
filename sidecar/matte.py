"""
Behind-the-speaker captions: a person matte for the frames under the captions that ask for it.

Invoked through the transcription sidecar (one-shot process, no Whisper model):
  transcribe --matte <job.json>
  job: {"path": "/in.mp4", "ranges": [[start, end], ...],      seconds; only these stretches are cut out
        "cacheDir": ".../matte", "modelDir": ".../models"}

For every frame (FPS a second, on a fixed grid: frame i is at i / FPS s) inside the ranges a person
segmentation network (u2net_human_seg, ONNX, 320x320) says which pixels are the speaker. The result is
  <cacheDir>/<key>/<i>.png   grey + alpha PNG, 320x320, alpha = the speaker (what the editor preview draws on top)
  <cacheDir>/<key>/matte.mp4 the same as a grey video over the whole clip, black where nothing was cut out
                             (what the export lays over the captions)
Frames already cut out are kept, so adding one more caption only costs its own frames.
The model (176 MB) is downloaded once into modelDir, checked against its SHA-256.

Stdout protocol (newline-delimited JSON):
  {"type": "status",   "message": "..."}
  {"type": "progress", "value": 0-100}
  {"type": "done", "dir", "video", "fps", "size", "frames": [i, ...]}
  {"type": "error",    "message": "..."}
  {"type": "cancelled"}

Writing "cancel" to stdin (or closing stdin) stops the job.
"""

import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import threading
import time
import urllib.request
import zlib

from subtitle_render import probe, _watch_stdin

FPS = 12
SIZE = 320
MODEL_FILE = "u2net_human_seg.onnx"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"
MODEL_SHA256 = "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c"
MODEL_BYTES = 175997641
MAX_RANGES = 500
CACHE_DAYS = 30

CANCELLED = "cancelled"


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# ── ranges and frames ────────────────────────────────────────────────────────

def frame_ranges(ranges, duration, fps=FPS):
    """[[start s, end s], ...] → sorted, merged [(first frame, end frame)) on the frame grid, inside the clip."""
    last = max(1, int(math.ceil(duration * fps))) if duration else None
    out = []
    for r in ranges or []:
        try:
            a, b = float(r[0]), float(r[1])
        except (TypeError, ValueError, IndexError):
            continue
        if not (math.isfinite(a) and math.isfinite(b)) or b <= a:
            continue
        i0, i1 = max(0, int(math.floor(a * fps))), int(math.ceil(b * fps))
        if last is not None:
            i1 = min(i1, last)
        if i1 > i0:
            out.append([i0, i1])
    out.sort()
    merged = []
    for i0, i1 in out:
        if merged and i0 <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], i1)
        else:
            merged.append([i0, i1])
    return [tuple(m) for m in merged]


def cache_key(path):
    st = os.stat(path)
    return hashlib.sha1(f"{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}".encode("utf-8")).hexdigest()[:16]


def prune_cache(cache_dir, keep, days=CACHE_DAYS):
    """Drop the matte caches of other videos not used for `days` days."""
    try:
        now = time.time()
        for name in os.listdir(cache_dir):
            p = os.path.join(cache_dir, name)
            if name != keep and os.path.isdir(p) and now - os.path.getmtime(p) > days * 86400:
                shutil.rmtree(p, ignore_errors=True)
    except OSError:
        pass


# ── tiny PNG (grey + alpha, 8 bit, filter 0): written and read here only ─────

def png_write(path, mask):
    """`mask`: uint8 array (SIZE, SIZE). White pixels whose alpha is the mask."""
    import numpy as np

    h, w = mask.shape
    ga = np.empty((h, w, 2), dtype=np.uint8)
    ga[..., 0] = 255
    ga[..., 1] = mask
    raw = b"".join(b"\x00" + ga[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 4, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, path)


def png_read(path):
    """The alpha plane of a PNG written by `png_write`, as uint8 (SIZE, SIZE); None if it isn't one."""
    import numpy as np

    try:
        with open(path, "rb") as f:
            data = f.read()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        pos, idat, w, h = 8, b"", 0, 0
        while pos + 8 <= len(data):
            n = struct.unpack(">I", data[pos:pos + 4])[0]
            tag = data[pos + 4:pos + 8]
            body = data[pos + 8:pos + 8 + n]
            if tag == b"IHDR":
                w, h = struct.unpack(">II", body[:8])
                if body[8:10] != b"\x08\x04":
                    return None
            elif tag == b"IDAT":
                idat += body
            pos += 12 + n
        raw = zlib.decompress(idat)
        rows = np.frombuffer(raw, dtype=np.uint8).reshape(h, 1 + w * 2)
        if rows[:, 0].any():
            return None
        return rows[:, 1:].reshape(h, w, 2)[..., 1].copy()
    except Exception:
        return None


# ── the model ────────────────────────────────────────────────────────────────

def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ensure_model(model_dir, emit=_emit, cancelled=None, url=MODEL_URL, sha=MODEL_SHA256):
    """Path of the model file, downloaded (once) when it is not there yet."""
    os.makedirs(model_dir, exist_ok=True)
    dest = os.path.join(model_dir, MODEL_FILE)
    if os.path.isfile(dest) and (os.path.getsize(dest) == MODEL_BYTES or sha != MODEL_SHA256):
        return dest
    emit({"type": "status", "message": "Qed ninżżel il-mudell tal-persuna (176 MB, darba biss)…"})
    part = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "Banditur"})
    got = 0
    last = -1
    with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as f:
        total = int(r.headers.get("Content-Length") or MODEL_BYTES)
        while True:
            if cancelled is not None and cancelled.is_set():
                f.close()
                os.remove(part)
                return None
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            got += len(b)
            pct = min(19, int(got / max(1, total) * 20))
            if pct != last:
                last = pct
                emit({"type": "progress", "value": pct})
    if _sha256(part) != sha:
        os.remove(part)
        raise RuntimeError("Il-mudell li niżżel mhux korrett. Erġa' pprova.")
    os.replace(part, dest)
    return dest


class Segmenter:
    """u2net_human_seg through onnxruntime (CPU)."""

    def __init__(self, model_path):
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.log_severity_level = 3
        self.session = ort.InferenceSession(model_path, so, providers=["CPUExecutionProvider"])
        self.name = self.session.get_inputs()[0].name

    def __call__(self, frames):
        """(n, SIZE, SIZE, 3) uint8 RGB → (n, SIZE, SIZE) float32 0-1."""
        import numpy as np

        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        out = []
        for fr in frames:
            x = ((fr.astype(np.float32) / 255.0 - mean) / std).transpose(2, 0, 1)[None]
            pred = self.session.run(None, {self.name: x})[0][0, 0]
            lo, hi = float(pred.min()), float(pred.max())
            # a frame with nobody in it must stay empty, not be stretched to full range
            out.append(((pred - lo) / (hi - lo)) if hi - lo > 0.5 else np.zeros_like(pred))
        return np.stack(out) if out else np.zeros((0, SIZE, SIZE), dtype=np.float32)


def shape(m):
    """Soft 0-1 mask → crisper alpha (smoothstep between 0.2 and 0.8), uint8."""
    import numpy as np

    t = np.clip((m - 0.2) / 0.6, 0.0, 1.0)
    return np.rint(t * t * (3 - 2 * t) * 255).astype(np.uint8)


def smooth(masks):
    """1-2-1 average over neighbouring frames, so the edge does not flicker. (n, H, W) float → same."""
    import numpy as np

    if len(masks) < 3:
        return masks
    out = masks.copy()
    out[1:-1] = 0.25 * masks[:-2] + 0.5 * masks[1:-1] + 0.25 * masks[2:]
    return out


# ── the job ──────────────────────────────────────────────────────────────────

def _decode(ffmpeg, path, i0, i1, proc_holder, cancelled):
    """Yield (n, SIZE, SIZE, 3) uint8 batches of frames i0..i1-1 (the frame grid), squashed to the model's size."""
    import numpy as np

    cmd = [ffmpeg, "-v", "error", "-ss", f"{i0 / FPS:.4f}", "-i", path, "-t", f"{(i1 - i0) / FPS:.4f}",
           "-an", "-vf", f"fps={FPS},scale={SIZE}:{SIZE}:flags=bilinear", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    proc_holder.proc = proc
    size = SIZE * SIZE * 3
    n = 0
    try:
        while n < i1 - i0 and not cancelled.is_set():
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(SIZE, SIZE, 3)
            n += 1
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()


def build_video(ffmpeg, frames_dir, total, out, proc_holder, cancelled):
    """matte.mp4: grey, FPS, `total` frames, black where no frame was cut out."""
    import numpy as np

    cmd = [ffmpeg, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{SIZE}x{SIZE}", "-r", str(FPS),
           "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "gray", "-movflags", "+faststart", out]
    tmp = out + ".part.mp4"
    cmd[-1] = tmp
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    proc_holder.proc = proc
    black = np.zeros((SIZE, SIZE), dtype=np.uint8).tobytes()
    have = {int(n[:-4]) for n in os.listdir(frames_dir) if n.endswith(".png") and n[:-4].isdigit()}
    try:
        for i in range(total):
            if cancelled.is_set():
                break
            m = png_read(os.path.join(frames_dir, f"{i}.png")) if i in have else None
            proc.stdin.write(m.tobytes() if m is not None else black)
        proc.stdin.close()
    except BrokenPipeError:
        pass
    err = proc.stderr.read().decode("utf-8", "replace")
    rc = proc.wait()
    if cancelled.is_set():
        if os.path.exists(tmp):
            os.remove(tmp)
        return False
    if rc != 0:
        raise RuntimeError((err.strip().splitlines() or ["ffmpeg ma setax ibni l-matte."])[-1])
    os.replace(tmp, out)
    return True


def run_matte(job_path, find_ffmpeg, segmenter=None, emit=_emit):
    """`segmenter(frames) -> masks` may be given (tests); otherwise the model is fetched and loaded."""
    from fireworks import _Current

    try:
        with open(job_path, encoding="utf-8") as f:
            job = json.load(f)
        path = job.get("path")
        if not path or not os.path.isfile(path):
            raise RuntimeError(f"Fajl ma nstabx: {path}")
        cache_dir, model_dir = job.get("cacheDir"), job.get("modelDir")
        if not cache_dir or not model_dir:
            raise RuntimeError("Job invalidu.")
        ranges = job.get("ranges") or []
        if len(ranges) > MAX_RANGES:
            raise RuntimeError("Wisq subtitles biex jinqatgħu.")

        import numpy as np

        cancelled = threading.Event()
        current = _Current()
        threading.Thread(target=_watch_stdin, args=(current, cancelled), daemon=True).start()
        ffmpeg = find_ffmpeg()
        dur, _w, _h, _fps = probe(ffmpeg, path)
        spans = frame_ranges(ranges, dur)
        if not spans:
            raise RuntimeError("L-ebda subtitle biex jinqata'.")
        key = cache_key(path)
        frames_dir = os.path.join(cache_dir, key)
        os.makedirs(frames_dir, exist_ok=True)
        os.utime(frames_dir, None)
        prune_cache(cache_dir, key)

        todo = [(i0, i1) for i0, i1 in spans]
        need = sum(i1 - i0 for i0, i1 in todo)
        def missing(i):
            return not os.path.isfile(os.path.join(frames_dir, f"{i}.png"))
        pending = sum(1 for i0, i1 in todo for i in range(i0, i1) if missing(i))

        if pending and segmenter is None:
            model = ensure_model(model_dir, emit, cancelled)
            if model is None:
                emit({"type": "cancelled"})
                return 0
            emit({"type": "status", "message": "Qed inħoll is-sagoma tal-ispeaker…"})
            try:
                segmenter = Segmenter(model)
            except ImportError:
                raise RuntimeError("Aġġorna l-engine (Settings → Components) biex tuża s-sagoma tal-ispeaker.")
        base = 20 if pending else 0
        done_frames = 0
        for i0, i1 in todo:
            if cancelled.is_set():
                break
            if not any(missing(i) for i in range(i0, i1)):
                done_frames += i1 - i0
                continue
            idx, batch = [], []
            for k, fr in enumerate(_decode(ffmpeg, path, i0, i1, current, cancelled)):
                i = i0 + k
                if missing(i):
                    idx.append(i)
                    batch.append(fr)
                done_frames += 1
                if pending:
                    emit({"type": "progress", "value": base + int(done_frames / max(1, need) * (90 - base))})
            if cancelled.is_set():
                break
            if batch:
                masks = smooth(segmenter(np.stack(batch)))
                for i, m in zip(idx, masks):
                    png_write(os.path.join(frames_dir, f"{i}.png"), shape(m))
        if cancelled.is_set():
            emit({"type": "cancelled"})
            return 0

        emit({"type": "status", "message": "Qed nagħmel il-matte…"})
        total = max(1, int(math.ceil(dur * FPS))) if dur else max(i1 for _, i1 in spans)
        video = os.path.join(frames_dir, "matte.mp4")
        if not build_video(ffmpeg, frames_dir, total, video, current, cancelled):
            emit({"type": "cancelled"})
            return 0
        frames = sorted(int(n[:-4]) for n in os.listdir(frames_dir) if n.endswith(".png") and n[:-4].isdigit())
        emit({"type": "progress", "value": 100})
        emit({"type": "done", "dir": frames_dir, "video": video, "fps": FPS, "size": SIZE, "frames": frames})
        return 0
    except Exception as exc:
        emit({"type": "error", "message": str(exc).splitlines()[0] if str(exc) else type(exc).__name__})
        return 0
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass
