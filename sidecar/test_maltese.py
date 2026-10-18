"""Run: python3 sidecar/test_maltese.py — checks sidecar/maltese.py against the shared cases."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from maltese import merge_tokens, merge_words  # noqa: E402

with open(os.path.join(HERE, "..", "src", "subtitles", "maltese-cases.json"), encoding="utf-8") as f:
    CASES = json.load(f)

failed = 0
for case in CASES["merge"]:
    got = [t for _, _, t in merge_tokens(case["in"])]
    if got != case["out"]:
        failed += 1
        print(f"✗ {case['in']} → {got}, expected {case['out']}")

words = [{"word": " Kienet", "start": 0.0, "end": 0.4, "probability": 0.9},
         {"word": " L", "start": 0.5, "end": 0.6, "probability": 0.8},
         {"word": " -festa", "start": 0.6, "end": 1.1, "probability": 0.95}]
merged = merge_words(words)
expect = {"word": " l-festa", "start": 0.5, "end": 1.1, "probability": 0.8}
if len(merged) != 2 or {k: merged[1][k] for k in expect} != expect:
    failed += 1
    print(f"✗ merge_words timing: {merged}")

if failed:
    sys.exit(f"{failed} Maltese case(s) failed")
print(f"✓ {len(CASES['merge']) + 1} Maltese cases passed (Python)")
