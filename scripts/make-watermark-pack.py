#!/usr/bin/env python3
"""Build a Banditur watermark pack (.bwpack) from a folder of watermarks.

The source folder uses the old bundled layout — one sub-folder per photographer,
named as it should appear in the app, holding portrait.png and/or landscape.png:

    src-tauri/watermarks/
    ├── Jacques Xuereb/{portrait,landscape}.png
    └── Sebio Audio Visuals/landscape.png

Usage:
    python3 scripts/make-watermark-pack.py SRC_DIR --name "Banditur" [--id banditur]
                                           [--version 1] [--out Banditur.bwpack]

Only the Python standard library is used. The app re-validates everything on
import (see src-tauri/src/wm_pack.rs), but this script applies the same rules so
problems show up here first.
"""
import argparse
import json
import re
import struct
import sys
import unicodedata
import zipfile
from pathlib import Path

FORMAT = "banditur-watermark-pack"
FORMAT_VERSION = 1
ORIENTATIONS = ("portrait", "landscape")
MALTESE = str.maketrans({"ħ": "h", "ġ": "g", "ċ": "c", "ż": "z"})


def slugify(name: str) -> str:
    s = name.lower().translate(MALTESE)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:64].rstrip("-")


def check_png(path: Path, orientation: str) -> None:
    data = path.read_bytes()[:33]
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError(f"{path}: not a PNG")
    w, h, _bit_depth, color_type = struct.unpack(">IIBB", data[16:26])
    if color_type not in (4, 6):  # grey+alpha, RGBA
        raise ValueError(f"{path}: needs a transparent (alpha) background")
    if orientation == "portrait" and h <= w:
        raise ValueError(f"{path}: portrait must be taller than wide ({w}x{h})")
    if orientation == "landscape" and w <= h:
        raise ValueError(f"{path}: landscape must be wider than tall ({w}x{h})")
    if abs(max(w, h) / min(w, h) - 1.5) > 0.015:
        raise ValueError(f"{path}: must be 3:2 / 2:3 (e.g. 6000x4000), got {w}x{h}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("--name", required=True, help="pack name shown in the app")
    ap.add_argument("--id", help="pack id (default: slug of --name)")
    ap.add_argument("--version", type=int, default=1)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()

    pack_id = a.id or slugify(a.name)
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", pack_id) or len(pack_id) > 64:
        ap.error(f"invalid pack id {pack_id!r}")
    out = a.out or Path(f"{a.name}.bwpack")

    entries, files, seen = [], [], set()
    for folder in sorted(p for p in a.src.iterdir() if p.is_dir() and not p.name.startswith(".")):
        wid = slugify(folder.name)
        if not wid or wid in seen:
            print(f"error: {folder.name!r} gives an empty or duplicate id {wid!r}", file=sys.stderr)
            return 1
        found = []
        for o in ORIENTATIONS:
            p = folder / f"{o}.png"
            if p.is_file():
                check_png(p, o)
                found.append((f"{wid}/{o}.png", p))
        if not found:
            print(f"skip: {folder.name!r} has no portrait.png or landscape.png", file=sys.stderr)
            continue
        seen.add(wid)
        entries.append({"id": wid, "name": folder.name})
        files += found
        print(f"  {folder.name:<28} → {wid:<24} {', '.join(Path(f).stem for f, _ in found)}")

    if not entries:
        print("error: no watermarks found", file=sys.stderr)
        return 1

    manifest = {
        "format": FORMAT,
        "formatVersion": FORMAT_VERSION,
        "id": pack_id,
        "name": a.name,
        "version": a.version,
        "watermarks": entries,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    # PNGs are already compressed, so store them.
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for arc, p in files:
            z.write(p, arc)
    print(f"\nWrote {out} — pack '{a.name}' ({pack_id}) v{a.version}, {len(entries)} watermarks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
