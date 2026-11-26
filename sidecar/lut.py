"""
LUT (.cube) support for the Murtali export and thumbnails.

A job may carry  "lut": {"path": "/x/S-Log3 to 709.cube", "strength": 0.0-1.0}.
The file is copied to a temp folder with a plain name first, so no path ever needs escaping
inside an ffmpeg filter graph (user paths have spaces, Maltese letters and quotes).

  strength 1   → lut3d (tetrahedral)
  strength 0-1 → the graded picture blended over the original at that opacity, in 16-bit RGB
  strength 0 / no lut → nothing
"""

import os
import re
import shutil
import tempfile

SAFE = re.compile(r"^[A-Za-z0-9_./-]+$")
MAX_BYTES = 64 * 1024 * 1024


def check_cube(path):
    """Size of a 3D .cube LUT; raises a Maltese error for anything else."""
    if not path or not os.path.isfile(path):
        raise RuntimeError("Il-LUT ma nstabx.")
    if not path.lower().endswith(".cube") or os.path.getsize(path) > MAX_BYTES:
        raise RuntimeError("Il-LUT irid ikun file .cube.")
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            key = s.split()[0].upper()
            if key == "LUT_1D_SIZE":
                raise RuntimeError("Dan huwa LUT 1D; għandu jkun LUT 3D (.cube).")
            if key == "LUT_3D_SIZE":
                try:
                    n = int(s.split()[1])
                except (IndexError, ValueError):
                    break
                if 2 <= n <= 256:
                    return n
                break
            if key[0].isdigit() or key[0] in "-.":
                break
    raise RuntimeError("Dan il-file mhux LUT 3D .cube validu.")


def strength_of(lut):
    try:
        s = float((lut or {}).get("strength", 1.0))
    except (TypeError, ValueError):
        s = 1.0
    return max(0.0, min(1.0, s))


def stage(lut, workdir):
    """Copy the job's LUT next to the work files; returns (safe_path, strength) or None."""
    if not lut or not lut.get("path"):
        return None
    s = strength_of(lut)
    if s < 0.005:
        return None
    check_cube(lut["path"])
    base = workdir if workdir and SAFE.match(workdir) else tempfile.mkdtemp(prefix="banditur-lut-", dir="/tmp")
    dest = os.path.join(base, "lut.cube")
    shutil.copyfile(lut["path"], dest)
    return dest, s


def chain(staged, tag=""):
    """Filter-chain prefix (no input/output labels) applying the staged LUT; '' when None."""
    if not staged:
        return ""
    path, s = staged
    if not SAFE.match(path):
        raise RuntimeError("Path tal-LUT mhux sigur.")
    lut3d = f"lut3d=file={path}:interp=tetrahedral"
    if s >= 0.995:
        return lut3d
    return (f"format=gbrp16le,split[lo{tag}][lg{tag}];[lg{tag}]{lut3d}[lt{tag}];"
            f"[lt{tag}][lo{tag}]blend=all_mode=normal:all_opacity={s:.3f}")
