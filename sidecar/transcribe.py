#!/usr/bin/env python3
"""
Transcription sidecar for Banditur.

Two modes:
  argv[1] given  → direct mode  (load model, transcribe, exit)
  no argv        → preload mode (load model, emit ready, read path from stdin, transcribe, exit)

Stdout protocol (newline-delimited JSON):
  {"type": "status",   "message": "..."}
  {"type": "progress", "value": <float 0-100 or -1 for indeterminate>}
  {"type": "ready"}                                 ← preload mode only
  {"type": "done",     "srt_path": "...", "segments": [...]}
  {"type": "error",    "message": "..."}

Segment schema:
  {"start": float, "end": float, "speaker": str,
   "words": [{"word": str, "start": float, "end": float, "probability": float}]}

Environment variables:
  WHISPER_MODEL   — model name/path (default: carlosdanielhernandezmena/...)
  WHISPER_LANG    — language code (default: mt)
  HF_TOKEN        — HuggingFace token for pyannote diarization (optional)
  MAX_CAPTION_SEC — max caption duration in seconds (default: 4)
"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile


# ── Protocol helpers ──────────────────────────────────────────────────────────

def _emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)

def status(msg: str)     -> None: _emit({"type": "status",   "message": msg})
def progress(val: float) -> None: _emit({"type": "progress", "value":   val})
def error(msg: str)      -> None: _emit({"type": "error",    "message": msg})


# ── SRT timestamp ─────────────────────────────────────────────────────────────

def _ts(seconds: float) -> str:
    h  = int(seconds // 3600)
    m  = int((seconds % 3600) // 60)
    s  = int(seconds % 60)
    ms = min(round((seconds % 1) * 1000), 999)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ── Audio extraction ──────────────────────────────────────────────────────────

def extract_audio(video_path: str, out_wav: str) -> None:
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-ar", "16000", "-ac", "1", "-vn", out_wav],
        capture_output=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace"))


# ── Model loader ──────────────────────────────────────────────────────────────

def load_model(model_name: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError(
            "faster-whisper mhux installat.\n"
            "Agħmel: cd sidecar && pip install -r requirements.txt"
        )
    return WhisperModel(model_name, device="cpu", compute_type="int8")


# ── Transcription ─────────────────────────────────────────────────────────────

def transcribe(model, audio_path: str) -> list:
    lang = os.environ.get("WHISPER_LANG", "mt")
    raw_segments, info = model.transcribe(
        audio_path,
        language=lang,
        task="transcribe",
        word_timestamps=True,
        beam_size=5,
    )
    duration = info.duration or 1.0
    segments = []
    for seg in raw_segments:
        words = []
        if seg.words:
            for w in seg.words:
                words.append({
                    "word":        w.word,
                    "start":       round(float(w.start), 3),
                    "end":         round(float(w.end),   3),
                    "probability": round(float(w.probability), 4),
                })
        else:
            # No word-level timestamps — treat whole segment as one word
            words.append({
                "word":        seg.text.strip(),
                "start":       round(float(seg.start), 3),
                "end":         round(float(seg.end),   3),
                "probability": 0.9,
            })
        segments.append({
            "start":   round(float(seg.start), 3),
            "end":     round(float(seg.end),   3),
            "speaker": "SPEAKER_00",
            "words":   words,
        })
        progress(min(int(seg.end / duration * 100), 99))
    return segments


# ── Caption splitting ─────────────────────────────────────────────────────────

def split_segments(segments: list, max_duration: float) -> list:
    """Split segments longer than max_duration at word boundaries."""
    out = []
    for seg in segments:
        if seg["end"] - seg["start"] <= max_duration or len(seg["words"]) <= 1:
            out.append(seg)
            continue

        chunk_words  = []
        chunk_start  = seg["start"]

        for w in seg["words"]:
            chunk_words.append(w)
            chunk_end = w["end"]
            # Flush when the chunk hits the limit AND there's at least one word
            if chunk_end - chunk_start >= max_duration:
                out.append({
                    "start":   chunk_start,
                    "end":     chunk_end,
                    "speaker": seg["speaker"],
                    "words":   chunk_words,
                })
                chunk_words = []
                chunk_start = chunk_end

        if chunk_words:
            out.append({
                "start":   chunk_start,
                "end":     seg["end"],
                "speaker": seg["speaker"],
                "words":   chunk_words,
            })

    return out


# ── Speaker diarization (optional — requires pyannote.audio + HF_TOKEN) ───────

def _load_diarization_pipeline(hf_token: str):
    from pyannote.audio import Pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,          # use_auth_token was deprecated in pyannote 4.x
    )
    # Use Apple Silicon GPU if available
    try:
        import torch
        if torch.backends.mps.is_available():
            pipeline.to(torch.device("mps"))
    except Exception:
        pass
    return pipeline


def diarize(audio_path: str, hf_token: str) -> list:
    """Return [{start, end, speaker}, ...] from pyannote diarization."""
    pipeline = _load_diarization_pipeline(hf_token)
    result   = pipeline(audio_path)
    return [
        {"start": turn.start, "end": turn.end, "speaker": label}
        for turn, _, label in result.itertracks(yield_label=True)
    ]


def assign_speakers(segments: list, diarization: list) -> list:
    """Replace each segment's speaker with the one having the most overlap."""
    for seg in segments:
        best_speaker = seg.get("speaker", "SPEAKER_00")
        best_overlap = 0.0
        for d in diarization:
            overlap = min(seg["end"], d["end"]) - max(seg["start"], d["start"])
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = d["speaker"]
        seg["speaker"] = best_speaker
    return segments


# ── SRT writer ────────────────────────────────────────────────────────────────

def write_srt(srt_path: str, segments: list) -> None:
    lines, n = [], 0
    for s in segments:
        text = "".join(w["word"] for w in s["words"]).strip()
        if not text:
            continue
        n += 1
        lines += [str(n), f"{_ts(s['start'])} --> {_ts(s['end'])}",
                  f"[{s['speaker']}]: {text}", ""]
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ── Core pipeline ─────────────────────────────────────────────────────────────

def run_pipeline(video_path: str, model) -> None:
    srt_path    = str(pathlib.Path(video_path).with_suffix(".srt"))
    hf_token    = os.environ.get("HF_TOKEN", "").strip()
    max_cap_sec = float(os.environ.get("MAX_CAPTION_SEC", "4"))

    status("Qed niekstraxxu l-awdjo…")
    progress(-1)

    tmp_wav = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            tmp_wav = tf.name
        extract_audio(video_path, tmp_wav)

        status("Qed nittraskrivi…")
        progress(-1)
        segments = transcribe(model, tmp_wav)

        # ── Split long captions ───────────────────────────────────────────────
        status("Qed nissepara l-kaptjonijiet…")
        segments = split_segments(segments, max_cap_sec)

        # ── Speaker diarization (optional) ────────────────────────────────────
        if not hf_token:
            # Fall back to the token cached by `huggingface-cli login`
            _cache = pathlib.Path.home() / ".cache" / "huggingface" / "token"
            if _cache.exists():
                hf_token = _cache.read_text().strip()

        if hf_token:
            try:
                status("Qed nidentifika s-suppleturi…")
                progress(-1)
                diar = diarize(tmp_wav, hf_token)
                segments = assign_speakers(segments, diar)
            except ImportError:
                status("pyannote.audio mhux installat — qed nittraża SPEAKER_00.")
            except Exception as e:
                status(f"Djarizzazzjoni ma rnexxietx: {str(e).splitlines()[0]}")

        status("Qed nikteb is-SRT…")
        write_srt(srt_path, segments)

        progress(100)
        _emit({"type": "done", "srt_path": srt_path, "segments": segments})
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.unlink(tmp_wav)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    model_name = os.environ.get("WHISPER_MODEL", "carlosdanielhernandezmena/whisper-large-maltese-8k-steps-64h-ct2")

    if len(sys.argv) >= 2:
        # ── Direct mode ───────────────────────────────────────────────────────
        video_path = sys.argv[1]
        if not os.path.isfile(video_path):
            error(f"Fajl ma nstabx: {video_path}")
            sys.exit(1)
        status(f"Qed nitlob il-mudell '{model_name}'…")
        progress(-1)
        model = load_model(model_name)
        run_pipeline(video_path, model)

    else:
        # ── Preload mode ──────────────────────────────────────────────────────
        # Load the model silently while the user picks a file, then wait.
        model = load_model(model_name)
        _emit({"type": "ready"})

        video_path = sys.stdin.readline().strip()
        if not video_path:
            error("L-ebda video path ma wasal.")
            sys.exit(1)
        if not os.path.isfile(video_path):
            error(f"Fajl ma nstabx: {video_path}")
            sys.exit(1)

        run_pipeline(video_path, model)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import traceback
        error(f"{exc}\n{traceback.format_exc()}")
        sys.exit(1)
