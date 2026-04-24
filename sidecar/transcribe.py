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
  {"type": "done",     "srt_path": "...", "all_words": [...]}
  {"type": "error",    "message": "..."}

Word schema:
  {"word": str, "start": float, "end": float, "probability": float, "speaker": str}

Environment variables:
  MLX_MODEL_PATH  — path or HF repo for mlx-whisper
                    (default: <project_root>/mlx-maltese-whisper-4bit)
  WHISPER_LANG    — language code (default: mt)
  HF_TOKEN        — HuggingFace token for pyannote diarization (optional)
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


# ── Audio extraction ──────────────────────────────────────────────────────────

def extract_audio(video_path: str, out_wav: str) -> None:
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-ar", "16000", "-ac", "1", "-vn", out_wav],
        capture_output=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace"))


# ── MLX Whisper ───────────────────────────────────────────────────────────────

def _default_model_path() -> str:
    local = pathlib.Path(__file__).parent.parent / "mlx-maltese-whisper-4bit"
    if local.exists():
        return str(local)
    return "mlx-community/whisper-large-v3-mlx"


def load_model(model_path: str) -> str:
    try:
        import mlx_whisper  # noqa: F401
    except ImportError:
        raise RuntimeError(
            "mlx-whisper mhux installat.\n"
            "Agħmel: cd sidecar && pip install mlx-whisper"
        )
    return model_path


def transcribe_audio(model_path: str, audio_path: str) -> list:
    import mlx_whisper
    lang = os.environ.get("WHISPER_LANG", "mt")

    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo=model_path,
        word_timestamps=True,
        language=lang,
    )

    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "word":        w.get("word", ""),
                "start":       round(float(w.get("start",       0)), 3),
                "end":         round(float(w.get("end",         0)), 3),
                "probability": round(float(w.get("probability", 0.9)), 4),
            })
    return words


# ── Speaker diarization (optional — requires pyannote.audio + HF_TOKEN) ───────

def _load_diarization_pipeline(hf_token: str):
    from pyannote.audio import Pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )
    try:
        import torch
        if torch.backends.mps.is_available():
            pipeline.to(torch.device("mps"))
    except Exception:
        pass
    return pipeline


def diarize(audio_path: str, hf_token: str) -> list:
    pipeline = _load_diarization_pipeline(hf_token)
    result   = pipeline(audio_path)
    return [
        {"start": turn.start, "end": turn.end, "speaker": label}
        for turn, _, label in result.itertracks(yield_label=True)
    ]


def assign_speakers_midpoint(words: list, diarization: list) -> list:
    """
    Compute mid = start + (end-start)/2 for each word.
    Find the diarization segment containing mid → assign that speaker.
    Words whose midpoint falls outside all segments are dropped
    (implicit VAD / hallucination filter).
    """
    out = []
    for w in words:
        mid     = w["start"] + (w["end"] - w["start"]) / 2
        speaker = None
        for d in diarization:
            if d["start"] <= mid <= d["end"]:
                speaker = d["speaker"]
                break
        if speaker is not None:
            out.append({**w, "speaker": speaker})
    return out


# ── Core pipeline ─────────────────────────────────────────────────────────────

def run_pipeline(video_path: str, model_path: str) -> None:
    srt_path = str(pathlib.Path(video_path).with_suffix(".srt"))
    hf_token = os.environ.get("HF_TOKEN", "").strip()

    status("Qed niekstraxxu l-awdjo…")
    progress(-1)

    tmp_wav = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            tmp_wav = tf.name
        extract_audio(video_path, tmp_wav)

        # ── Optional: diarize FIRST so speaker info is ready before whisper ───
        if not hf_token:
            _cache = pathlib.Path.home() / ".cache" / "huggingface" / "token"
            if _cache.exists():
                hf_token = _cache.read_text().strip()

        diar = None
        if hf_token:
            try:
                status("Qed nidentifika s-suppleturi…")
                progress(-1)
                diar = diarize(tmp_wav, hf_token)
            except ImportError:
                status("pyannote.audio mhux installat — qed nittraża SPEAKER_00.")
            except Exception as e:
                status(f"Djarizzazzjoni ma rnexxietx: {str(e).splitlines()[0]}")

        # ── Transcribe ────────────────────────────────────────────────────────
        status("Qed nittraskrivi…")
        progress(-1)
        words = transcribe_audio(model_path, tmp_wav)

        # ── Assign speakers via midpoint intersection (or default) ─────────────
        if diar is not None:
            words = assign_speakers_midpoint(words, diar)
        else:
            for w in words:
                w["speaker"] = "SPEAKER_00"

        progress(100)
        _emit({"type": "done", "srt_path": srt_path, "all_words": words})
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.unlink(tmp_wav)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    model_path = os.environ.get("MLX_MODEL_PATH", _default_model_path())

    if len(sys.argv) >= 2:
        # ── Direct mode ───────────────────────────────────────────────────────
        video_path = sys.argv[1]
        if not os.path.isfile(video_path):
            error(f"Fajl ma nstabx: {video_path}")
            sys.exit(1)
        status("Qed nitlob il-mudell…")
        progress(-1)
        model_path = load_model(model_path)
        run_pipeline(video_path, model_path)

    else:
        # ── Preload mode ──────────────────────────────────────────────────────
        model_path = load_model(model_path)
        _emit({"type": "ready"})

        video_path = sys.stdin.readline().strip()
        if not video_path:
            error("L-ebda video path ma wasal.")
            sys.exit(1)
        if not os.path.isfile(video_path):
            error(f"Fajl ma nstabx: {video_path}")
            sys.exit(1)

        run_pipeline(video_path, model_path)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import traceback
        error(f"{exc}\n{traceback.format_exc()}")
        sys.exit(1)
