#!/usr/bin/env python3
"""
Build the subtitle fonts bundled with Banditur into public/fonts/.

Downloads OFL fonts from github.com/google/fonts, turns variable fonts into
single-weight files with their own family name (so libass and the webview
pick exactly the same face), checks Maltese coverage, and copies each OFL
licence alongside.

Usage: python3 scripts/build-fonts.py   (needs: pip install fonttools)
"""
import os
import sys
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "fonts")
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl"

# family name → (google/fonts dir, file, axis values or None for static fonts)
FONTS = {
    # Montserrat is the only family: one variable font, four weights.
    "Montserrat SemiBold": ("montserrat", "Montserrat[wght].ttf", {"wght": 600}),
    "Montserrat Bold": ("montserrat", "Montserrat[wght].ttf", {"wght": 700}),
    "Montserrat ExtraBold": ("montserrat", "Montserrat[wght].ttf", {"wght": 800}),
    "Montserrat Black": ("montserrat", "Montserrat[wght].ttf", {"wght": 900}),
}


def fetch(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def rename(font, family):
    ps = family.replace(" ", "") + "-Regular"
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (16, 17, 21, 22, 25):
            name.removeNames(nameID=rec.nameID)
    for nid, val in ((1, family), (2, "Regular"), (3, f"Banditur:{ps}"), (4, family), (6, ps)):
        name.setName(val, nid, 3, 1, 0x409)
        name.setName(val, nid, 1, 0, 0)
    if "OS/2" in font:
        font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0b100001) | 0b1000000  # REGULAR
    if "head" in font:
        font["head"].macStyle = 0


def main():
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    from importlib import import_module
    check = import_module("check-fonts")
    os.makedirs(OUT, exist_ok=True)
    bad = 0
    for family, (d, fn, axes) in FONTS.items():
        src = fetch(f"{BASE}/{d}/{fn.replace('[', '%5B').replace(']', '%5D')}")
        tmp = os.path.join(OUT, ".tmp.ttf")
        with open(tmp, "wb") as f:
            f.write(src)
        font = TTFont(tmp)
        if axes:
            font = instantiateVariableFont(font, axes, updateFontNames=False)
        rename(font, family)
        out = os.path.join(OUT, family.replace(" ", "") + ".ttf")
        font.save(out)
        os.remove(tmp)
        lic = fetch(f"{BASE}/{d}/OFL.txt")
        with open(os.path.join(OUT, f"OFL-{family.replace(' ', '')}.txt"), "wb") as f:
            f.write(lic)
        miss = check.missing(out)
        # libass sizes fonts by usWinAscent + usWinDescent; FONTS[].em in
        # src/subtitles/styles.js must equal unitsPerEm / that sum.
        o, upm = font["OS/2"], font["head"].unitsPerEm
        em = upm / (o.usWinAscent + o.usWinDescent)
        print(("✓" if not miss else "✗"), family, f"em={em:.3f}", "" if not miss else f"missing {''.join(miss)}")
        bad += bool(miss)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
