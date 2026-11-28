"""
Awdjo: the pure parts of the enhancement (no MLX, no ffmpeg), so they can be tested anywhere.

RE-USE was trained on clips shorter than 10 s, so a long recording is cut into overlapping chunks, each
chunk is enhanced on its own, and the results are cross-faded with a Hann window (overlap-add), the same
scheme as mlx-audio's `generate()` (5 s chunks, 50 % overlap). Channels are enhanced one by one.
"""

import math

import numpy as np

# Sample rates the model accepts (Hz); anything else is resampled to FALLBACK_RATE.
SUPPORTED_RATES = (8000, 16000, 22050, 24000, 32000, 44100, 48000)
FALLBACK_RATE = 48000
CHUNK_SECONDS = 5.0
OVERLAP_SECONDS = 2.5

LAYOUT_CHANNELS = {
    "mono": 1, "stereo": 2, "2.1": 3, "3.0": 3, "3.0(back)": 3, "4.0": 4, "quad": 4, "quad(side)": 4,
    "3.1": 4, "5.0": 5, "5.0(side)": 5, "4.1": 5, "5.1": 6, "5.1(side)": 6, "6.0": 6, "6.0(front)": 6,
    "hexagonal": 6, "6.1": 7, "7.0": 7, "7.1": 8, "7.1(wide)": 8, "7.1(wide-side)": 8, "octagonal": 8,
}


def channels_of(layout):
    """Channel count from an ffmpeg layout word ('stereo', '5.1(side)', '4 channels', '3 channels (FL+FR+LFE)')."""
    text = (layout or "").strip().lower()
    if text in LAYOUT_CHANNELS:
        return LAYOUT_CHANNELS[text]
    base = text.split(" ")[0]
    if base in LAYOUT_CHANNELS and "channel" not in text:
        return LAYOUT_CHANNELS[base]
    import re
    m = re.match(r"(\d+)\s+channels?", text)
    if m:
        return int(m.group(1))
    return None


def working_rate(rate, container=""):
    """The rate the audio is processed (and written) at: the source's when the model supports it, else 48 kHz.
    MXF carries 48 kHz audio only."""
    if container == "mxf":
        return 48000
    return int(rate) if int(rate) in SUPPORTED_RATES else FALLBACK_RATE


def plan_chunks(length, rate, chunk_seconds=CHUNK_SECONDS, overlap_seconds=OVERLAP_SECONDS):
    """(chunk, starts): the chunk length in samples and where each chunk begins.
    A recording that fits in one chunk is a single pass (chunk == length). The last chunk is aligned to the
    end, so every sample is covered and no chunk is shorter than the others."""
    if length <= 0:
        raise ValueError("empty audio")
    if not (chunk_seconds > 0 and 0 <= overlap_seconds < chunk_seconds):
        raise ValueError("overlap must be non-negative and less than the chunk")
    chunk = max(1, int(chunk_seconds * rate))
    overlap = int(overlap_seconds * rate)
    if length <= chunk:
        return length, [0]
    hop = chunk - overlap
    if hop < 1:
        raise ValueError("chunk hop must be at least one sample")
    starts = list(range(0, length - chunk, hop)) + [length - chunk]
    return chunk, starts


def chunk_window(chunk):
    """Hann cross-fade weights for one chunk (never exactly zero, so the first sample divides cleanly)."""
    return np.maximum(np.hanning(chunk + 1)[:-1], 1e-7).astype(np.float32)


class OverlapAdd:
    """Accumulates enhanced chunks into one channel: `add(start, chunk_audio)`, then `result()`."""

    def __init__(self, length, chunk):
        self.chunk = chunk
        self.window = chunk_window(chunk)
        self.out = np.zeros(length, dtype=np.float32)
        self.total = np.zeros(length, dtype=np.float32)

    def add(self, start, audio):
        n = len(audio)
        if n != self.chunk:
            raise ValueError("chunk has the wrong length")
        self.out[start:start + n] += np.asarray(audio, dtype=np.float32) * self.window
        self.total[start:start + n] += self.window

    def result(self):
        return self.out / np.maximum(self.total, 1e-12)


def enhance_channel(audio, rate, enhance_one, on_chunk=None, cancelled=None,
                    chunk_seconds=CHUNK_SECONDS, overlap_seconds=OVERLAP_SECONDS):
    """Enhance one channel (1-D float32) chunk by chunk. `enhance_one(chunk_audio) -> array` of the same length;
    `on_chunk(i, n)` reports progress; `cancelled()` → True stops early (returns None)."""
    audio = np.asarray(audio, dtype=np.float32)
    length = len(audio)
    chunk, starts = plan_chunks(length, rate, chunk_seconds, overlap_seconds)
    if len(starts) == 1:
        out = np.asarray(enhance_one(audio), dtype=np.float32)
        if on_chunk:
            on_chunk(1, 1)
        return out
    acc = OverlapAdd(length, chunk)
    for i, s in enumerate(starts):
        if cancelled and cancelled():
            return None
        acc.add(s, np.asarray(enhance_one(audio[s:s + chunk]), dtype=np.float32))
        if on_chunk:
            on_chunk(i + 1, len(starts))
    return acc.result()


def mix(dry, wet, strength):
    """Wet/dry blend (strength 0..1), clipped to full scale."""
    s = float(min(1.0, max(0.0, strength)))
    out = wet if s >= 0.999 else (s * wet + (1.0 - s) * dry)
    return np.clip(out, -1.0, 1.0).astype(np.float32, copy=False)


def fit_length(audio, n):
    """Trim or zero-pad a channel to exactly n samples."""
    if len(audio) == n:
        return audio
    if len(audio) > n:
        return audio[:n]
    return np.concatenate([audio, np.zeros(n - len(audio), dtype=audio.dtype)])


def chunk_count(length, rate, channels=1):
    """Total model calls for a file (for progress and time estimates)."""
    return len(plan_chunks(length, rate)[1]) * channels
