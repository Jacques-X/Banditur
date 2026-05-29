#!/usr/bin/env python3
"""
Beat-sync sidecar for Banditur.

Detects audio onsets/beats and writes a DaVinci Resolve-friendly FCPXML timeline
that places still images on video track 1 and the source audio underneath.
"""

import argparse
import json
import pathlib
from xml.sax.saxutils import escape


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


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


def detect_cut_frames(audio_path: pathlib.Path, fps: int, sensitivity: float, min_gap_frames: int) -> tuple[list[int], int]:
    try:
        import librosa
    except ImportError as exc:
        raise RuntimeError("librosa mhux installat. Ħaddem: venv/bin/pip install -r sidecar/requirements.txt") from exc

    y, sr = librosa.load(str(audio_path), sr=None, mono=True)
    duration_seconds = float(librosa.get_duration(y=y, sr=sr))
    total_frames = max(1, seconds_to_frames(duration_seconds, fps))

    onset_frames = librosa.onset.onset_detect(
        y=y,
        sr=sr,
        units="time",
        backtrack=True,
        delta=float(sensitivity),
        wait=max(1, int(sr / fps / 512)),
    )

    cuts = [0]
    for onset_time in onset_frames:
        frame = seconds_to_frames(float(onset_time), fps)
        if frame <= 0 or frame >= total_frames:
            continue
        if frame - cuts[-1] >= min_gap_frames:
            cuts.append(frame)

    if total_frames - cuts[-1] >= max(1, min_gap_frames // 2):
        cuts.append(total_frames)
    elif len(cuts) == 1:
        cuts.append(total_frames)
    else:
        cuts[-1] = total_frames

    return cuts, total_frames


def list_images(image_dir: pathlib.Path) -> list[pathlib.Path]:
    return sorted(
        p for p in image_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


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

    cut_frames, total_frames = detect_cut_frames(audio_path, args.fps, args.sensitivity, args.min_gap)
    clip_count = generate_fcpxml(
        output_path,
        audio_path,
        image_paths,
        cut_frames,
        args.fps,
        args.loop_images,
    )

    emit({
        "type": "done",
        "output_path": str(output_path),
        "image_count": len(image_paths),
        "clip_count": clip_count,
        "beat_count": max(0, len(cut_frames) - 2),
        "duration_frames": total_frames,
        "duration_seconds": round(total_frames / args.fps, 3),
    })
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        raise SystemExit(1)
