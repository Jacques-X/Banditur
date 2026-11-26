"""
Murtali (fireworks) video export for Banditur.

Invoked through the transcription sidecar:  transcribe --fireworks-render <job.json>

job.json:
  {"kind": "full" | "reel", "output": "/out.mp4", "size": "auto" | "1080p",
   "items": [{"path": "/clip.mp4", "start": 12.0, "end": 31.5, "crop": {"x": 0.5} | null}, ...],
   "lut": {"path": "/x.cube", "strength": 0.0-1.0} | null}

  lut  → applied to every item's picture first (on the source pixels, before crop/scale); see lut.py.

  full → every item in the order given, 16:9 (1920x1080, or 3840x2160 for a 4K first source
         unless size is "1080p"). A 16:9 source is only cut; any other shape is fitted inside
         16:9 over a blurred copy of itself, never stretched.
  reel → 1080x1920 (9:16): a full-height 9:16 window per item, centred on crop.x (0-1 across
         the source width, 0.5 when missing). Portrait sources are only scaled/padded.

Sound is always the clip's own audio (never replaced or mixed). Each cut gets a 0.3 s audio
crossfade, the picture cuts hard, and the result is loudness-normalised (loudnorm -14 LUFS).
To keep picture and sound the same length each input is opened 0.3 s long (clamped to the
source) and the video is trimmed back; the audio keeps the extra 0.3 s the crossfade overlaps.

More than CHUNK items: chunks of CHUNK are rendered without loudnorm, joined by stream copy,
and one last pass normalises the sound (video copied). The crossfade is therefore missing at
each chunk joint (a hard audio cut).

Stdout protocol is the same as subtitle_render: status / progress / done {path} / error / cancelled.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

from subtitle_render import probe, _watch_stdin
import lut as lutmod

XFADE = 0.3
CHUNK = 30
MIN_ITEM = 0.2
LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11"
# loudnorm resamples internally; pin the output back (aresample after loudnorm fails in ffmpeg 4.4)
OUT_FMT = "aformat=sample_rates=48000:channel_layouts=stereo"


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def _status(msg):
    _emit({"type": "status", "message": msg})


def output_size(job, first):
    """(width, height) of the output."""
    if job["kind"] == "reel":
        return 1080, 1920
    if job.get("size") != "1080p" and first and first.get("w", 0) >= 3840:
        return 3840, 2160
    return 1920, 1080


def output_fps(first):
    fps = float(first.get("fps") or 30.0) if first else 30.0
    if fps <= 0:
        fps = 30.0
    return min(60.0, fps)


def crop_window(x, src_w, src_h):
    """Pixel window (x, w) of a full-height 9:16 crop centred on x (0-1), clamped to the frame."""
    cw = int(src_h * 9 / 16)
    cw -= cw % 2
    cw = max(2, min(cw, src_w))
    try:
        centre = float(x) if x is not None else 0.5
    except (TypeError, ValueError):
        centre = 0.5
    centre = max(0.0, min(1.0, centre))
    left = int(centre * src_w - cw / 2 + 0.5)
    return max(0, min(left, src_w - cw)), cw


def video_chain(job, item, src, size, fps, tag):
    """Filter chain (without input/output labels) for one input; `tag` makes inner labels unique."""
    W, H = size
    w, h = src.get("w") or 0, src.get("h") or 0
    pre = f"fps={fps:g}"
    if not (w and h):
        raise RuntimeError("Il-video m'għandux stampa.")
    if job["kind"] == "full":
        if abs(w / h - 16 / 9) <= 0.01 * 16 / 9:
            return f"{pre},scale={W}:{H},setsar=1"
        return (f"{pre},split[fa{tag}][fb{tag}];"
                f"[fa{tag}]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=20[bg{tag}];"
                f"[fb{tag}]scale={W}:{H}:force_original_aspect_ratio=decrease[fg{tag}];"
                f"[bg{tag}][fg{tag}]overlay=(W-w)/2:(H-h)/2,setsar=1")
    # reel
    if w * 16 <= h * 9 * 1.01:       # already portrait 9:16 (or narrower): scale / pad only
        return (f"{pre},scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1")
    x, cw = crop_window((item.get("crop") or {}).get("x"), w, h)
    return f"{pre},crop={cw}:{h}:{x}:0,scale={W}:{H},setsar=1"


def item_length(item, src):
    return max(0.0, float(item["end"]) - float(item["start"]))


def build_command(ffmpeg, job, info, items=None, output=None, normalise=True):
    """The ffmpeg command for `items` (default: job['items']). `info[path]` = {dur, w, h, fps}."""
    items = list(job["items"] if items is None else items)
    if not items:
        raise RuntimeError("L-ebda murtal biex tiġi esportata.")
    size = output_size(job, info[job["items"][0]["path"]])
    fps = output_fps(info[job["items"][0]["path"]])
    out = output or job["output"]
    cmd = [ffmpeg, "-y", "-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1"]
    graph = []
    total = 0.0
    n = len(items)
    for i, item in enumerate(items):
        src = info[item["path"]]
        start = max(0.0, float(item["start"]))
        dur = item_length(item, src)
        if dur < MIN_ITEM:
            raise RuntimeError("Murtal qasir wisq biex jiġi esportat.")
        total += dur
        ext = dur + XFADE
        if src.get("dur"):
            ext = min(ext, max(0.0, src["dur"] - start))
        cmd += ["-ss", f"{start:.3f}", "-t", f"{ext:.3f}", "-i", item["path"]]
        pre = lutmod.chain(job.get("_lut"), i)
        graph.append(f"[{i}:v]{pre + ',' if pre else ''}{video_chain(job, item, src, size, fps, i)},"
                     f"trim=duration={dur:.3f},setpts=PTS-STARTPTS,format=yuv420p[v{i}]")
        full_ext = dur + XFADE
        graph.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,"
                     f"apad=whole_dur={full_ext:.3f},atrim=duration={full_ext:.3f}[a{i}]")
    graph.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vout]")
    last = "a0"
    for i in range(1, n):
        label = f"x{i}"
        graph.append(f"[{last}][a{i}]acrossfade=d={XFADE:g}[{label}]")
        last = label
    tail = (LOUDNORM + "," + OUT_FMT) if normalise else "anull"
    graph.append(f"[{last}]{tail}[aout]")
    cmd += ["-filter_complex", ";".join(graph), "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-write_tmcd", "0", out]
    return cmd


def _run(cmd, total, base, span, cancelled_box, workdir):
    """Run ffmpeg, emitting progress base..base+span (percent). Returns (returncode, was_cancelled)."""
    log_path = os.path.join(workdir, "ffmpeg.log")
    with open(log_path, "w", encoding="utf-8", errors="replace") as log:
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=log,
                                text=True, errors="replace")
        cancelled_box["proc"] = proc
        if cancelled_box.get("cancel"):
            proc.terminate()
        last = -1
        for line in proc.stdout:
            line = line.strip()
            if line.startswith(("out_time_us=", "out_time_ms=")) and total > 0:
                try:
                    secs = int(line.split("=", 1)[1]) / 1_000_000
                except ValueError:
                    continue
                pct = int(base + max(0.0, min(1.0, secs / total)) * span)
                pct = max(0, min(99, pct))
                if pct != last:
                    last = pct
                    _emit({"type": "progress", "value": pct})
        rc = proc.wait()
    if rc != 0 and not cancelled_box.get("cancel"):
        with open(log_path, encoding="utf-8", errors="replace") as f:
            tail = [l for l in f.read().splitlines() if l.strip()][-6:]
        sys.stderr.write("\n".join(tail) + "\n")
        raise RuntimeError(tail[-1] if tail else f"ffmpeg ħareġ b'kodiċi {rc}")
    return rc


def _watch(box):
    """Cancel on a 'cancel' line (or EOF) on stdin."""
    cancelled = threading.Event()

    def loop():
        try:
            for line in sys.stdin:
                if line.strip().lower() == "cancel":
                    break
        except Exception:
            pass
        box["cancel"] = True
        cancelled.set()
        proc = box.get("proc")
        if proc is not None and proc.poll() is None:
            proc.terminate()

    threading.Thread(target=loop, daemon=True).start()
    return cancelled


def render(job, find_ffmpeg, box=None, workdir=None):
    """Render the job; returns True when finished, False when cancelled."""
    box = box if box is not None else {}
    ffmpeg = find_ffmpeg()
    if job.get("kind") not in ("full", "reel"):
        raise RuntimeError("Tip tal-esportazzjoni invalidu.")
    items = job.get("items") or []
    if not items:
        raise RuntimeError("L-ebda murtal biex tiġi esportata.")
    info = {}
    for it in items:
        p = it["path"]
        if p not in info:
            if not os.path.isfile(p):
                raise RuntimeError(f"Fajl ma nstabx: {p}")
            d, w, h, fps = probe(ffmpeg, p)
            info[p] = {"dur": d, "w": w, "h": h, "fps": fps}
    total = sum(item_length(it, None) for it in items)
    _status("Qed nesporta…")
    _emit({"type": "progress", "value": 0})
    own = workdir is None
    work = workdir or tempfile.mkdtemp(prefix="banditur-fireworks-")
    try:
        staged = lutmod.stage(job.get("lut"), work)
        if staged:
            job = {**job, "_lut": staged}
        if len(items) <= CHUNK:
            _run(build_command(ffmpeg, job, info), total, 0, 100, box, work)
        else:
            parts = []
            done = 0.0
            for ci in range(0, len(items), CHUNK):
                chunk = items[ci:ci + CHUNK]
                part = os.path.join(work, f"part{ci // CHUNK:03d}.mp4")
                cdur = sum(item_length(it, None) for it in chunk)
                _run(build_command(ffmpeg, job, info, items=chunk, output=part, normalise=False),
                     cdur, done / total * 90, cdur / total * 90, box, work)
                if box.get("cancel"):
                    break
                done += cdur
                parts.append(part)
            if not box.get("cancel"):
                lst = os.path.join(work, "parts.txt")
                with open(lst, "w", encoding="utf-8") as f:
                    for p in parts:
                        f.write("file '" + p.replace("'", "'\\''") + "'\n")
                _run([ffmpeg, "-y", "-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
                      "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "copy", "-af", LOUDNORM + "," + OUT_FMT,
                      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", job["output"]],
                     total, 90, 10, box, work)
        if box.get("cancel"):
            try:
                os.remove(job["output"])
            except OSError:
                pass
            return False
        return True
    finally:
        if own:
            shutil.rmtree(work, ignore_errors=True)


def run_fireworks_render(job_path, find_ffmpeg):
    try:
        with open(job_path, encoding="utf-8") as f:
            job = json.load(f)
        if not job.get("output"):
            raise RuntimeError("Job invalidu: 'output' nieqes.")
        box = {}
        _watch(box)
        ok = render(job, find_ffmpeg, box)
        if not ok:
            _emit({"type": "cancelled"})
            return 0
        _emit({"type": "progress", "value": 100})
        _emit({"type": "done", "path": job["output"]})
        return 0
    except Exception as exc:
        _emit({"type": "error", "message": str(exc).splitlines()[0] if str(exc) else type(exc).__name__})
        return 0
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass
