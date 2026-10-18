#!/usr/bin/env python3
"""
Check that subtitle fonts cover everything Maltese captions need.

Usage: python3 scripts/check-fonts.py public/fonts/*.ttf
Exits non-zero if any font is missing a required character.
"""
import string
import sys

from fontTools.ttLib import TTFont

MALTESE = "ĦħĠġĊċŻżÀàÈèÌìÒòÙù"
PUNCT = "’‘“”–—€…«»"
REQUIRED = MALTESE + PUNCT + string.ascii_letters + string.digits + "!\"#%&'()*+,-./:;?@"


def missing(path):
    font = TTFont(path, lazy=True)
    cmap = font.getBestCmap() or {}
    return [c for c in REQUIRED if ord(c) not in cmap]


def main(paths):
    bad = 0
    for p in paths:
        m = missing(p)
        if m:
            bad += 1
            print(f"✗ {p}: missing {''.join(m)}")
        else:
            print(f"✓ {p}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
