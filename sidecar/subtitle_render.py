"""
Subtitle video export for Banditur (Traskrittura).

Invoked through the transcription sidecar:  transcribe --render <job.json>

job.json:
  {"video": "/in.mp4", "ass": "/tmp/subs.ass", "output": "/out.mp4",
   "mode": "burn" | "alpha", "fonts": ["Helvetica Neue"],
   "fontsDir": "/…/Resources/fonts",            (optional: bundled fonts, all included)
   "logo": {"path": "/logo.png", "corner": "tr", "widthPct": 12,
            "opacity": 0.9, "marginPct": 4}}      (optional corner logo)

  burn  → H.264 MP4 with the subtitles burned in (audio re-encoded to AAC)
  alpha → ProRes 4444 MOV, subtitles only on a transparent background, same
          size / frame rate / length as the source — drop it on any timeline.

Uses the same ffmpeg as transcription (imageio-ffmpeg in release builds), which
is built with libass. Fonts are handed to libass through a private fontsdir
containing only the requested families, so rendering doesn't depend on the
static ffmpeg build finding a fontconfig setup on the Mac.

Stdout protocol (newline-delimited JSON, same as transcription):
  {"type": "status",   "message": "..."}
  {"type": "progress", "value": 0-100}
  {"type": "done",     "path": "/out.mp4"}
  {"type": "error",    "message": "..."}
  {"type": "cancelled"}

Writing "cancel" to stdin (or closing stdin) stops ffmpeg.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

FONT_DIRS = [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    os.path.expanduser("~/Library/Fonts"),
    "/usr/share/fonts",          # Linux (dev/testing)
    "/usr/local/share/fonts",
]
FONT_EXT = (".ttf", ".otf", ".ttc")
FALLBACK_FAMILIES = ["Helvetica", "Arial", "DejaVu Sans"]


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def _status(msg):
    _emit({"type": "status", "message": msg})


def _norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _link(src, dst):
    try:
        os.symlink(src, dst)
    except OSError:
        try:
            shutil.copyfile(src, dst)
        except OSError:
            return False
    return True


def collect_fonts(families, dest, bundled_dir=None):
    """Symlink (or copy) the bundled fonts plus system fonts matching the family names."""
    keys = [_norm(f) for f in list(families or []) + FALLBACK_FAMILIES if f and _norm(f)]
    found = 0
    seen = set()
    if bundled_dir and os.path.isdir(bundled_dir):
        for fn in os.listdir(bundled_dir):
            if fn.lower().endswith(FONT_EXT) and fn not in seen and _link(os.path.join(bundled_dir, fn), os.path.join(dest, fn)):
                seen.add(fn)
                found += 1
    for root in FONT_DIRS:
        if not os.path.isdir(root):
            continue
        walker = os.walk(root) if root.startswith("/usr") else [(root, [], os.listdir(root))]
        for d, _, files in walker:
            for fn in files:
                if not fn.lower().endswith(FONT_EXT):
                    continue
                stem = _norm(os.path.splitext(fn)[0])
                if not any(stem.startswith(k) for k in keys) or fn in seen:
                    continue
                seen.add(fn)
                if _link(os.path.join(d, fn), os.path.join(dest, fn)):
                    found += 1
    return found


def write_fontconfig(work, fonts_dir):
    """Private fontconfig setup: our fonts first, a throw-away cache, system dirs after."""
    conf = os.path.join(work, "fonts.conf")
    cache = os.path.join(work, "fc-cache")
    os.makedirs(cache, exist_ok=True)
    dirs = "".join(f"<dir>{d}</dir>" for d in [fonts_dir] + [d for d in FONT_DIRS if os.path.isdir(d)])
    with open(conf, "w", encoding="utf-8") as f:
        f.write(f'<?xml version="1.0"?><fontconfig>{dirs}<cachedir>{cache}</cachedir></fontconfig>')
    return conf


_SELECT = re.compile(r"fontselect:\s*\((.*?),\s*(\d+),\s*(\d+)\)\s*->\s*(.*?),\s*(-?\d+),\s*(.*)$")


def fonts_used(log_path):
    """[(requested, picked_file, picked_name)] from libass's fontselect lines."""
    out = []
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = _SELECT.search(line)
                if m:
                    item = (m.group(1), os.path.basename(m.group(4)), m.group(6).strip())
                    if item not in out:
                        out.append(item)
    except OSError:
        pass
    return out


def probe(ffmpeg, path):
    """Duration (s), width, height, fps of the first video stream (parsed from ffmpeg -i)."""
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace")
    info = r.stderr
    dur = 0.0
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
    if m:
        dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    w = h = 0
    fps = 30.0
    for line in info.splitlines():
        if "Video:" not in line:
            continue
        sm = re.search(r"\b(\d{2,5})x(\d{2,5})\b", line)
        if sm:
            w, h = int(sm.group(1)), int(sm.group(2))
        fm = re.search(r"(\d+(?:\.\d+)?)\s*fps", line) or re.search(r"(\d+(?:\.\d+)?)\s*tbr", line)
        if fm:
            fps = float(fm.group(1))
        # rotated phone videos report the stored size; ffmpeg auto-rotates on decode
        break
    rot = re.search(r"rotate\s*:\s*(-?\d+)", info) or re.search(r"rotation of (-?\d+(?:\.\d+)?)", info)
    if rot and abs(round(float(rot.group(1)))) % 180 == 90:
        w, h = h, w
    return dur, w, h, fps


def _watch_stdin(proc, cancelled):
    try:
        for line in sys.stdin:
            if line.strip().lower() == "cancel":
                break
    except Exception:
        pass
    # "cancel" or stdin closed (the app went away) → stop ffmpeg
    if proc.poll() is None:
        cancelled.set()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _logo_filter(logo, w, h, base_label):
    """Filter-graph tail overlaying a corner logo onto [base_label] → [v]."""
    width = max(8, int(w * float(logo.get("widthPct", 12)) / 100))
    margin = int(min(w, h) * float(logo.get("marginPct", 4)) / 100)
    opacity = max(0.0, min(1.0, float(logo.get("opacity", 1))))
    corner = logo.get("corner", "tr")
    x = f"{margin}" if corner in ("tl", "bl") else f"W-w-{margin}"
    y = f"{margin}" if corner in ("tl", "tr") else f"H-h-{margin}"
    return (f"[1:v]format=rgba,scale={width}:-1,colorchannelmixer=aa={opacity:.3f}[logo];"
            f"[{base_label}][logo]overlay=x={x}:y={y}:format=auto:shortest=1[v]")


def build_command(ffmpeg, job, dur, w, h, fps):
    end = max(0.0, min(8.0, float(job.get("endCardSeconds") or 0)))
    vf = "ass=subs.ass:fontsdir=fonts"
    # End card: hold a black frame after the video; the card's text is an ASS event at that time.
    vf_burn = (f"tpad=stop_mode=add:stop_duration={end:g}:color=black," if end else "") + vf
    out = job["output"]
    logo = job.get("logo") if job.get("logo") and os.path.isfile(str(job["logo"].get("path", ""))) else None
    head = [ffmpeg, "-y", "-hide_banner", "-nostats", "-loglevel", "verbose", "-progress", "pipe:1"]
    if job["mode"] == "burn":
        inputs = ["-i", job["video"]] + (["-loop", "1", "-i", logo["path"]] if logo else [])
        if logo:
            graph = ["-filter_complex", f"[0:v]{vf_burn}[s];" + _logo_filter(logo, w, h, "s"), "-map", "[v]"]
        else:
            graph = ["-vf", vf_burn, "-map", "0:v:0"]
        if end:
            graph += ["-af", f"apad=pad_dur={end:g}"]
        return head + inputs + graph + [
            "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", "-movflags", "+faststart",
            # don't copy the camera's timecode track into the upload copy
            "-write_tmcd", "0",
            out,
        ]
    if not (w and h):
        raise RuntimeError("Il-video m'għandux stampa — ma nistax noħloq MOV trasparenti.")
    src = f"color=c=black@0.0:s={w}x{h}:r={fps:g}:d={max(dur + end, 0.1):.3f},format=rgba"
    inputs = ["-f", "lavfi", "-i", src] + (["-loop", "1", "-i", logo["path"]] if logo else [])
    if logo:
        graph = ["-filter_complex", f"[0:v]{vf}:alpha=1[s];" + _logo_filter(logo, w, h, "s") , "-map", "[v]", "-shortest"]
    else:
        graph = ["-vf", vf + ":alpha=1"]
    return head + inputs + graph + [
        "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
        "-vendor", "apl0", "-an",
        out,
    ]


def run_render(job_path, find_ffmpeg):
    try:
        with open(job_path, encoding="utf-8") as f:
            job = json.load(f)
        for key in ("video", "ass", "output", "mode"):
            if not job.get(key):
                raise RuntimeError(f"Job invalidu: '{key}' nieqes.")
        if job["mode"] not in ("burn", "alpha"):
            raise RuntimeError("Mod tal-esportazzjoni invalidu.")
        if not os.path.isfile(job["video"]):
            raise RuntimeError(f"Fajl ma nstabx: {job['video']}")

        ffmpeg = find_ffmpeg()
        _status("Qed naqra l-video…")
        dur, w, h, fps = probe(ffmpeg, job["video"])

        with tempfile.TemporaryDirectory(prefix="banditur-render-") as work:
            shutil.copyfile(job["ass"], os.path.join(work, "subs.ass"))
            fonts = os.path.join(work, "fonts")
            os.mkdir(fonts)
            collect_fonts(job.get("fonts"), fonts, job.get("fontsDir"))

            env = dict(os.environ, FONTCONFIG_FILE=write_fontconfig(work, fonts))
            cmd = build_command(ffmpeg, job, dur, w, h, fps)
            log_path = os.path.join(work, "ffmpeg.log")
            _status("Qed nesporta…")
            _emit({"type": "progress", "value": 0})
            with open(log_path, "w", encoding="utf-8", errors="replace") as log:
                proc = subprocess.Popen(
                    cmd, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                    stderr=log, text=True, errors="replace", env=env,
                )
                cancelled = threading.Event()
                threading.Thread(target=_watch_stdin, args=(proc, cancelled), daemon=True).start()
                last = -1
                for line in proc.stdout:
                    line = line.strip()
                    if line.startswith(("out_time_us=", "out_time_ms=")) and dur > 0:
                        try:
                            secs = int(line.split("=", 1)[1]) / 1_000_000
                        except ValueError:
                            continue
                        pct = max(0, min(99, int(secs / dur * 100)))
                        if pct != last:
                            last = pct
                            _emit({"type": "progress", "value": pct})
                rc = proc.wait()

            if cancelled.is_set():
                try:
                    os.remove(job["output"])
                except OSError:
                    pass
                _emit({"type": "cancelled"})
                return 0
            if rc != 0:
                with open(log_path, encoding="utf-8", errors="replace") as f:
                    tail = [l for l in f.read().splitlines() if l.strip()][-6:]
                sys.stderr.write("\n".join(tail) + "\n")
                msg = tail[-1] if tail else f"ffmpeg ħareġ b'kodiċi {rc}"
                raise RuntimeError(msg)

            used = fonts_used(log_path)
            for req, fn, name in used:
                sys.stderr.write(f"[fonts] asked '{req}' -> {fn} ({name})\n")
        _emit({"type": "progress", "value": 100})
        _emit({"type": "done", "path": job["output"],
               "fonts": [{"asked": r, "file": fn, "name": nm} for r, fn, nm in used]})
        return 0
    except Exception as exc:  # report as a protocol error, exit cleanly
        _emit({"type": "error", "message": str(exc).splitlines()[0] if str(exc) else type(exc).__name__})
        return 0
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass
