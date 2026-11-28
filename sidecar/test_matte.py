"""Behind-the-speaker captions: frame ranges, the cache, the matte video, and the export that puts the speaker over the text."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

import matte
import subtitle_render as sr

FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
S = matte.SIZE


def left_half(frames):
    """A stand-in for the network: the left half of the picture is 'the speaker'."""
    out = np.zeros((len(frames), S, S), dtype=np.float32)
    out[:, :, : S // 2] = 1.0
    return out


def run_job(job, segmenter):
    path = os.path.join(os.path.dirname(job["path"]), "job.json")
    with open(path, "w") as f:
        json.dump(job, f)
    events = []
    matte.run_matte(path, lambda: FFMPEG, segmenter=segmenter, emit=events.append)
    return events


class RangeTests(unittest.TestCase):
    def test_snapped_to_the_frame_grid_and_merged(self):
        r = matte.frame_ranges([[1.0, 2.0], [1.9, 3.0], [10.0, 10.5]], 20.0)
        self.assertEqual(r, [(12, 36), (120, 126)])

    def test_clamped_to_the_clip_and_junk_dropped(self):
        r = matte.frame_ranges([[-5, 1], [19.5, 99], [3, 3], ["x", 2], None, [float("nan"), 4]], 20.0)
        self.assertEqual(r, [(0, 12), (234, 240)])
        self.assertEqual(matte.frame_ranges([], 20.0), [])


class PngTests(unittest.TestCase):
    def test_roundtrip(self):
        d = tempfile.mkdtemp()
        try:
            m = np.random.default_rng(1).integers(0, 256, (S, S), dtype=np.uint8)
            p = os.path.join(d, "1.png")
            matte.png_write(p, m)
            self.assertEqual(open(p, "rb").read(8), b"\x89PNG\r\n\x1a\n")
            self.assertTrue(np.array_equal(matte.png_read(p), m))
            open(os.path.join(d, "bad.png"), "wb").write(b"nope")
            self.assertIsNone(matte.png_read(os.path.join(d, "bad.png")))
        finally:
            shutil.rmtree(d)

    def test_shape_and_smooth(self):
        m = np.array([[0.0, 0.2, 0.5, 0.8, 1.0]], dtype=np.float32)
        s = matte.shape(m)[0]
        self.assertEqual(s[0], 0)
        self.assertEqual(s[1], 0)
        self.assertEqual(s[3], 255)
        self.assertTrue(0 < s[2] < 255)
        a = np.zeros((3, 2, 2), dtype=np.float32)
        a[1] = 1.0
        out = matte.smooth(a)
        self.assertAlmostEqual(float(out[1, 0, 0]), 0.5)
        self.assertEqual(len(matte.smooth(a[:2])), 2)


class ModelTests(unittest.TestCase):
    def test_download_checks_the_hash(self):
        d = tempfile.mkdtemp()
        try:
            src = os.path.join(d, "src.onnx")
            open(src, "wb").write(b"model bytes")
            good = matte._sha256(src)
            ev = []
            p = matte.ensure_model(os.path.join(d, "m"), ev.append, None, url="file://" + src, sha=good)
            self.assertEqual(open(p, "rb").read(), b"model bytes")
            self.assertTrue(any(e["type"] == "status" for e in ev))
            again = []
            matte.ensure_model(os.path.join(d, "m"), again.append, None, url="file:///nonexistent", sha=good)
            self.assertEqual(again, [], "an installed model is not fetched again")
            with self.assertRaises(RuntimeError):
                matte.ensure_model(os.path.join(d, "m2"), ev.append, None, url="file://" + src, sha="0" * 64)
            self.assertFalse(os.path.exists(os.path.join(d, "m2", matte.MODEL_FILE)))
        finally:
            shutil.rmtree(d)


@unittest.skipUnless(os.path.isfile(FFMPEG), "ffmpeg needed")
class JobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="matte-test-")
        cls.clip = os.path.join(cls.dir, "clip.mp4")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x2040c0:s=320x180:r=25:d=6",
                        "-f", "lavfi", "-i", "sine=f=300:d=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", cls.clip], check=True)
        cls.cache = os.path.join(cls.dir, "cache")
        cls.models = os.path.join(cls.dir, "models")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def job(self, ranges):
        return {"path": self.clip, "ranges": ranges, "cacheDir": self.cache, "modelDir": self.models}

    def test_cuts_out_only_the_ranges_and_reuses_the_cache(self):
        calls = []

        def seg(frames):
            calls.append(len(frames))
            return left_half(frames)

        ev = run_job(self.job([[1.0, 2.0], [4.0, 4.5]]), seg)
        done = ev[-1]
        self.assertEqual(done["type"], "done", ev[-1])
        self.assertEqual(done["fps"], 12)
        self.assertEqual(done["frames"], list(range(12, 24)) + list(range(48, 54)))
        self.assertEqual(sum(calls), 18, "nothing outside the ranges is segmented")
        m = matte.png_read(os.path.join(done["dir"], "12.png"))
        self.assertEqual(int(m[:, : S // 2 - 8].min()), 255)
        self.assertEqual(int(m[:, S // 2 + 8:].max()), 0)
        # the matte video: whole clip, grey, left half white inside a range and black outside
        out = subprocess.run([FFMPEG, "-v", "error", "-i", done["video"], "-vf", "select=eq(n\\,15)+eq(n\\,40)", "-vsync", "0",
                              "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True).stdout
        self.assertEqual(len(out), 2 * S * S)
        f_in = np.frombuffer(out[: S * S], dtype=np.uint8).reshape(S, S)
        f_out = np.frombuffer(out[S * S:], dtype=np.uint8).reshape(S, S)
        self.assertGreater(int(f_in[:, : S // 2 - 20].mean()), 200)
        self.assertLess(int(f_in[:, S // 2 + 20:].mean()), 40)
        self.assertLess(int(f_out.max()), 20)
        n = int(subprocess.run([FFMPEG, "-v", "error", "-i", done["video"], "-f", "null", "-"], capture_output=True).returncode == 0)
        self.assertEqual(n, 1)
        # a second run with one more range only does the new frames
        calls.clear()
        ev2 = run_job(self.job([[1.0, 2.0], [4.0, 4.5], [2.0, 2.5]]), seg)
        self.assertEqual(ev2[-1]["type"], "done")
        self.assertEqual(sum(calls), 6)
        self.assertEqual(len(ev2[-1]["frames"]), 24)

    def test_errors_are_clear(self):
        ev = run_job({**self.job([]), "path": os.path.join(self.dir, "nope.mp4")}, left_half)
        self.assertEqual(ev[-1]["type"], "error")
        ev = run_job(self.job([]), left_half)
        self.assertEqual(ev[-1]["type"], "error")


@unittest.skipUnless(os.path.isfile(FFMPEG), "ffmpeg needed")
class ExportTests(unittest.TestCase):
    """Text behind the speaker: the speaker (left half here) covers the red box, the right half shows it."""

    ASS = """[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,40,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="matte-export-")
        cls.clip = os.path.join(cls.dir, "clip.mp4")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x2040c0:s=320x180:r=25:d=4",
                        "-f", "lavfi", "-i", "sine=f=300:d=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", cls.clip], check=True)
        job = {"path": cls.clip, "ranges": [[0, 4]], "cacheDir": os.path.join(cls.dir, "c"), "modelDir": os.path.join(cls.dir, "m")}
        cls.matte = run_job(job, left_half)[-1]["video"]
        box = r"{\an7\pos(100,40)\1c&H0000FF&\p1}m 0 0 l 120 0 120 100 0 100{\p0}"
        cls.behind = os.path.join(cls.dir, "behind.ass")
        open(cls.behind, "w").write(cls.ASS + f"Dialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,{box}\n")
        cls.front = os.path.join(cls.dir, "front.ass")
        open(cls.front, "w").write(cls.ASS)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def render(self, **extra):
        out = os.path.join(self.dir, "out.mp4")
        job = {"video": self.clip, "ass": self.front, "output": out, "mode": "burn", "fonts": [], "fontsDir": None, **extra}
        p = os.path.join(self.dir, "rj.json")
        json.dump(job, open(p, "w"))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            sr.run_render(p, lambda: FFMPEG)
        ev = [json.loads(l) for l in buf.getvalue().splitlines() if l.startswith("{")]
        self.assertEqual(ev[-1]["type"], "done", ev[-1])
        return out

    def pixels(self, path, t=2.0):
        raw = subprocess.run([FFMPEG, "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                             capture_output=True).stdout
        return np.frombuffer(raw, dtype=np.uint8).reshape(180, 320, 3)

    def test_speaker_covers_the_text_behind_it(self):
        px = self.pixels(self.render(assBehind=self.behind, matte=self.matte))
        left, right = px[90, 120], px[90, 190]          # inside the box: left of centre = the speaker, right = text
        self.assertGreater(int(right[0]), 200, f"text visible on the right: {right}")
        self.assertLess(int(left[0]), 90, f"hidden by the speaker on the left: {left}")
        self.assertGreater(int(left[2]), 120)

    def test_without_a_matte_it_is_the_plain_export(self):
        px = self.pixels(self.render())
        self.assertLess(int(px[90, 120][0]), 90)         # no text at all (front.ass is empty)

    def test_with_end_card_and_logo_the_graph_still_runs(self):
        logo = os.path.join(self.dir, "logo.png")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=40x40", "-frames:v", "1", logo], check=True)
        out = self.render(assBehind=self.behind, matte=self.matte, endCardSeconds=1.0,
                          logo={"path": logo, "corner": "tr", "widthPct": 10, "opacity": 1})
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
                                   capture_output=True, text=True).stdout)
        self.assertAlmostEqual(dur, 5.0, delta=0.3)


if __name__ == "__main__":
    unittest.main()
