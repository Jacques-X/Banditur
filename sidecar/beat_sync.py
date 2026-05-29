#!/usr/bin/env python3
"""
Beat-sync sidecar for Banditur.

Detects audio onsets/beats and writes a DaVinci Resolve-friendly FCPXML timeline
that places still images on video track 1 and the source audio underneath.
"""

import argparse
import json
import math
import pathlib
import shutil
from xml.sax.saxutils import escape


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

STYLE_PARAMS = {
    "calm": {
        "low_stride": 4,
        "mid_stride": 4,
        "high_stride": 2,
        "extra_onset_quantile": 0.98,
        "use_extra_onsets": False,
    },
    "balanced": {
        "low_stride": 4,
        "mid_stride": 2,
        "high_stride": 1,
        "extra_onset_quantile": 0.92,
        "use_extra_onsets": True,
    },
    "energetic": {
        "low_stride": 2,
        "mid_stride": 1,
        "high_stride": 1,
        "extra_onset_quantile": 0.84,
        "use_extra_onsets": True,
    },
}


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def file_url(path: pathlib.Path) -> str:
    return path.resolve().as_uri()


def xml_name(path: pathlib.Path) -> str:
    return escape(path.name)


def seconds_to_frames(seconds: float, fps: int) -> int:
    return max(0, int(round(seconds * fps)))


def frames_to_fcpx(frames: int, fps: int) -> str:
    return f"{max(0, int(frames))}/{fps}s"


def detect_cut_frames(
    audio_path: pathlib.Path,
    fps: int,
    sensitivity: float,
    min_gap_frames: int,
    max_gap_frames: int,
    style: str,
) -> tuple[list[int], int]:
    try:
        import librosa
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("librosa mhux installat. Ħaddem: venv/bin/pip install -r sidecar/requirements.txt") from exc

    params = STYLE_PARAMS.get(style, STYLE_PARAMS["balanced"])
    y, sr = librosa.load(str(audio_path), sr=None, mono=True)
    duration_seconds = float(librosa.get_duration(y=y, sr=sr))
    total_frames = max(1, seconds_to_frames(duration_seconds, fps))

    hop_length = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    if len(onset_env) == 0:
        return split_long_gaps([0, total_frames], max_gap_frames), total_frames

    onset_times = librosa.onset.onset_detect(
        y=y,
        sr=sr,
        units="time",
        backtrack=True,
        delta=float(sensitivity),
        hop_length=hop_length,
        wait=max(1, int(sr / fps / hop_length)),
    )

    _, beat_frames = librosa.beat.beat_track(
        y=y,
        sr=sr,
        onset_envelope=onset_env,
        hop_length=hop_length,
        trim=False,
    )
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length)
    beat_video_frames = [
        seconds_to_frames(float(t), fps)
        for t in beat_times
        if 0 < seconds_to_frames(float(t), fps) < total_frames
    ]

    if not beat_video_frames:
        onset_frames = [
            seconds_to_frames(float(t), fps)
            for t in onset_times
            if 0 < seconds_to_frames(float(t), fps) < total_frames
        ]
        cuts = filter_by_min_gap([0, *onset_frames, total_frames], min_gap_frames)
        return split_long_gaps(cuts, max_gap_frames), total_frames

    beat_strengths = strengths_at_times(onset_env, beat_times, sr, hop_length, np)
    section_intensity = moving_average(normalize(beat_strengths, np), window=16, np=np)

    candidates = choose_beat_grid_cuts(beat_video_frames, section_intensity, params)
    if params["use_extra_onsets"]:
        candidates.extend(
            choose_extra_onsets(
                onset_times,
                onset_env,
                sr,
                hop_length,
                fps,
                total_frames,
                params["extra_onset_quantile"],
                np,
            )
        )

    cuts = filter_by_min_gap([0, *candidates, total_frames], min_gap_frames)
    return split_long_gaps(cuts, max_gap_frames), total_frames


def strengths_at_times(onset_env, times, sr: int, hop_length: int, np):
    if len(times) == 0:
        return np.array([], dtype=float)
    idx = np.clip((np.array(times) * sr / hop_length).astype(int), 0, len(onset_env) - 1)
    return np.asarray(onset_env)[idx]


def normalize(values, np):
    values = np.asarray(values, dtype=float)
    if values.size == 0:
        return values
    lo = float(np.percentile(values, 10))
    hi = float(np.percentile(values, 90))
    if hi <= lo:
        return np.zeros_like(values)
    return np.clip((values - lo) / (hi - lo), 0.0, 1.0)


def moving_average(values, window: int, np):
    values = np.asarray(values, dtype=float)
    if values.size == 0 or window <= 1:
        return values
    kernel = np.ones(window, dtype=float) / window
    return np.convolve(values, kernel, mode="same")


def choose_beat_grid_cuts(beat_video_frames: list[int], section_intensity, params: dict) -> list[int]:
    cuts = []
    for i, frame in enumerate(beat_video_frames):
        intensity = float(section_intensity[i]) if i < len(section_intensity) else 0.5
        if intensity >= 0.66:
            stride = params["high_stride"]
        elif intensity <= 0.30:
            stride = params["low_stride"]
        else:
            stride = params["mid_stride"]

        # Bar starts are musically stable anchor points, especially for calmer cuts.
        if i % max(1, int(stride)) == 0 or (stride >= 4 and i % 4 == 0):
            cuts.append(frame)
    return cuts


def choose_extra_onsets(
    onset_times,
    onset_env,
    sr: int,
    hop_length: int,
    fps: int,
    total_frames: int,
    quantile: float,
    np,
) -> list[int]:
    if len(onset_times) == 0:
        return []
    strengths = strengths_at_times(onset_env, onset_times, sr, hop_length, np)
    if strengths.size == 0:
        return []
    threshold = float(np.quantile(strengths, quantile))
    frames = []
    for t, strength in zip(onset_times, strengths):
        if float(strength) < threshold:
            continue
        frame = seconds_to_frames(float(t), fps)
        if 0 < frame < total_frames:
            frames.append(frame)
    return frames


def filter_by_min_gap(candidates: list[int], min_gap_frames: int) -> list[int]:
    ordered = sorted(set(int(c) for c in candidates))
    if not ordered:
        return []

    cuts = []
    for frame in ordered:
        if not cuts or frame - cuts[-1] >= min_gap_frames:
            cuts.append(frame)

    final = ordered[-1]
    if cuts[-1] != final:
        if final - cuts[-1] < min_gap_frames and len(cuts) > 1:
            cuts[-1] = final
        else:
            cuts.append(final)

    if len(cuts) == 1:
        cuts.append(cuts[0] + max(1, min_gap_frames))
    return cuts


def split_long_gaps(cuts: list[int], max_gap_frames: int) -> list[int]:
    if max_gap_frames <= 0 or len(cuts) < 2:
        return cuts

    out = [cuts[0]]
    for end in cuts[1:]:
        start = out[-1]
        gap = end - start
        if gap > max_gap_frames:
            parts = max(2, math.ceil(gap / max_gap_frames))
            step = gap / parts
            for i in range(1, parts):
                out.append(round(start + step * i))
        out.append(end)
    return out


def list_images(image_dir: pathlib.Path) -> list[pathlib.Path]:
    return sorted(
        p for p in image_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def alpha_code(index: int) -> str:
    chars = []
    n = index
    while True:
        chars.append(chr(ord("a") + (n % 26)))
        n = n // 26 - 1
        if n < 0:
            break
    return "".join(reversed(chars))


def stage_images(output_path: pathlib.Path, image_paths: list[pathlib.Path]) -> tuple[list[pathlib.Path], pathlib.Path]:
    """
    Resolve eagerly treats timestamped/numbered still filenames as image sequences.
    Copy stills beside the FCPXML with non-numeric names so each one imports as
    an individual still clip.
    """
    stage_dir = output_path.with_suffix("").parent / f"{output_path.stem}_media"
    stage_dir.mkdir(parents=True, exist_ok=True)

    staged = []
    for i, image_path in enumerate(image_paths):
        suffix = image_path.suffix.lower()
        staged_path = stage_dir / f"banditur_{alpha_code(i)}{suffix}"
        shutil.copy2(image_path, staged_path)
        staged.append(staged_path)
    return staged, stage_dir


def generate_fcpxml(
    output_path: pathlib.Path,
    audio_path: pathlib.Path,
    image_paths: list[pathlib.Path],
    cut_frames: list[int],
    fps: int,
    loop_images: bool,
) -> int:
    clip_count = len(cut_frames) - 1
    if clip_count <= 0:
        raise RuntimeError("Ma nstabux biżżejjed beats biex tinħoloq timeline.")
    if not loop_images and clip_count > len(image_paths):
        clip_count = len(image_paths)

    sequence_frames = cut_frames[clip_count]
    audio_id = "r2"
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE fcpxml>',
        '<fcpxml version="1.8">',
        '  <resources>',
        f'    <format id="r1" name="FFVideoFormat{fps}p" frameDuration="1/{fps}s"/>',
        (
            f'    <asset id="{audio_id}" name="{xml_name(audio_path)}" '
            f'src="{escape(file_url(audio_path))}" start="0s" '
            f'duration="{frames_to_fcpx(sequence_frames, fps)}" hasAudio="1"/>'
        ),
    ]

    for idx, image_path in enumerate(image_paths):
        asset_id = f"r{idx + 3}"
        lines.append(
            f'    <asset id="{asset_id}" name="{xml_name(image_path)}" '
            f'src="{escape(file_url(image_path))}" start="0s" '
            f'duration="{frames_to_fcpx(sequence_frames, fps)}" hasVideo="1"/>'
        )

    lines.extend([
        '  </resources>',
        '  <library>',
        '    <event name="Banditur Beat Sync">',
        '      <project name="Beat-Synced Timeline">',
        (
            f'        <sequence format="r1" duration="{frames_to_fcpx(sequence_frames, fps)}" '
            'tcStart="0s" tcFormat="NDF">'
        ),
        '          <spine>',
        (
            f'            <asset-clip name="{xml_name(audio_path)}" ref="{audio_id}" '
            f'offset="0s" start="0s" duration="{frames_to_fcpx(sequence_frames, fps)}">'
        ),
    ])

    for i in range(clip_count):
        image_index = i % len(image_paths)
        image_path = image_paths[image_index]
        asset_id = f"r{image_index + 3}"
        offset = cut_frames[i]
        duration = max(1, cut_frames[i + 1] - cut_frames[i])
        lines.append(
            f'              <asset-clip name="{xml_name(image_path)}" ref="{asset_id}" '
            f'lane="1" offset="{frames_to_fcpx(offset, fps)}" start="0s" '
            f'duration="{frames_to_fcpx(duration, fps)}"/>'
        )

    lines.extend([
        '            </asset-clip>',
        '          </spine>',
        '        </sequence>',
        '      </project>',
        '    </event>',
        '  </library>',
        '</fcpxml>',
        '',
    ])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return clip_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--sensitivity", type=float, default=0.18)
    parser.add_argument("--min-gap", type=int, default=6)
    parser.add_argument("--max-gap", type=int, default=90)
    parser.add_argument("--style", choices=sorted(STYLE_PARAMS.keys()), default="balanced")
    parser.add_argument("--loop-images", action="store_true")
    args = parser.parse_args()

    audio_path = pathlib.Path(args.audio)
    image_dir = pathlib.Path(args.images)
    output_path = pathlib.Path(args.output)

    if not audio_path.is_file():
        raise RuntimeError(f"Il-fajl tal-awdjo ma nstabx: {audio_path}")
    if not image_dir.is_dir():
        raise RuntimeError(f"Il-folder tal-immaġni ma nstabx: {image_dir}")
    if args.fps < 1 or args.fps > 120:
        raise RuntimeError("FPS għandu jkun bejn 1 u 120.")

    image_paths = list_images(image_dir)
    if not image_paths:
        raise RuntimeError("L-ebda immaġni supportata ma nstabet fil-folder.")
    staged_image_paths, staged_dir = stage_images(output_path, image_paths)

    cut_frames, total_frames = detect_cut_frames(
        audio_path,
        args.fps,
        args.sensitivity,
        args.min_gap,
        args.max_gap,
        args.style,
    )
    clip_count = generate_fcpxml(
        output_path,
        audio_path,
        staged_image_paths,
        cut_frames,
        args.fps,
        args.loop_images,
    )

    emit({
        "type": "done",
        "output_path": str(output_path),
        "image_count": len(image_paths),
        "staged_dir": str(staged_dir),
        "clip_count": clip_count,
        "beat_count": max(0, len(cut_frames) - 2),
        "duration_frames": total_frames,
        "duration_seconds": round(total_frames / args.fps, 3),
        "style": args.style,
    })
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        raise SystemExit(1)
