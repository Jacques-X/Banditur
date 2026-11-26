"""Murtali: sound features, the render filter graph, and end-to-end runs on synthetic ffmpeg clips."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

import numpy as np

import fireworks
import fireworks_render as fr
import lut as lutmod

FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
HAVE_FFMPEG = os.path.isfile(FFMPEG)
RATE = 16000


def noise(rng, secs, amp):
    return rng.normal(0, amp, int(secs * RATE))


def burst_signal(times, total=30.0, lowpass=False, seed=1):
    """Quiet noise floor with decaying noise bursts at `times` (seconds)."""
    rng = np.random.default_rng(seed)
    x = noise(rng, total, 80.0)
    for t in times:
        n = int(0.6 * RATE)
        env = np.exp(-np.arange(n) / (0.08 * RATE))
        b = rng.normal(0, 1, n)
        if lowpass:
            b = np.convolve(b, np.ones(40) / 40, mode="same") * 6
        i = int(t * RATE)
        x[i:i + n] += b[: len(x) - i] * env[: len(x) - i] * 12000
    return np.clip(x, -32768, 32767).astype(np.int16)


_KEEP = []


def run_cap(fn, *args):
    """Run a sidecar entry point with an open (silent) stdin, like the app's pipe, and capture stdout."""
    out = io.StringIO()
    r, w = os.pipe()
    old_stdin = sys.stdin
    sys.stdin = os.fdopen(r)
    try:
        with contextlib.redirect_stdout(out):
            fn(*args)
    finally:
        os.close(w)          # EOF for the watcher thread (closing the reader under it can hang)
        _KEEP.append(sys.stdin)
        sys.stdin = old_stdin
    return [json.loads(l) for l in out.getvalue().splitlines() if l.strip()]


class FeatureTests(unittest.TestCase):
    def test_lengths_and_range(self):
        c = fireworks.features(burst_signal([5]), RATE)
        for k in ("rms", "transient", "low"):
            self.assertEqual(len(c[k]), 300)
            self.assertTrue(all(0 <= v <= 255 for v in c[k]))

    def test_bursts_land_in_the_right_bins(self):
        times = [3.0, 8.0, 14.0, 19.0, 25.0]
        c = fireworks.features(burst_signal(times), RATE)
        tr = c["transient"]
        for t in times:
            lo = int(t * 10)
            self.assertGreaterEqual(max(tr[lo - 1:lo + 3]), 200, f"burst at {t}")
        # quiet in between
        self.assertLess(max(tr[100:130]), 60)
        # and the loudness curve rises there too
        self.assertGreater(c["rms"][31], c["rms"][100] + 30)

    def test_sustained_band_scores_low_transient(self):
        t = np.arange(30 * RATE) / RATE
        band = sum(np.sin(2 * np.pi * f * t) / (i + 1) for i, f in enumerate([440, 880, 1320, 1760]))
        x = (band * 9000).astype(np.int16)
        c = fireworks.features(x, RATE)
        # steady sound: nothing rises far above the clip's own 99th percentile reference
        self.assertLess(float(np.median(c["transient"])), 40)
        self.assertGreater(c["rms"][100], 150)

    def test_low_passed_bursts_have_more_low_energy_than_voice_noise(self):
        bang = fireworks.features(burst_signal([5, 15, 25], lowpass=True), RATE)["low"]
        rng = np.random.default_rng(3)
        t = np.arange(30 * RATE) / RATE
        voice = (np.sin(2 * np.pi * 900 * t) * 6000 + rng.normal(0, 500, len(t))).astype(np.int16)
        v = fireworks.features(voice, RATE)["low"]
        self.assertGreater(max(bang[50:58]), np.mean(v) + 60)

    def test_empty_and_tiny(self):
        self.assertEqual(fireworks.features(np.zeros(0, dtype=np.int16))["rms"], [])
        c = fireworks.features(np.zeros(500, dtype=np.int16))
        self.assertEqual(len(c["rms"]), 1)
        self.assertEqual(c["transient"], [0])


class GraphTests(unittest.TestCase):
    def info(self, w=1920, h=1080, fps=30.0, dur=100.0):
        return {"/a.mp4": {"dur": dur, "w": w, "h": h, "fps": fps}}

    def cmd(self, kind, items, **kw):
        job = {"kind": kind, "output": "/out.mp4", "items": items, **kw}
        info = kw.pop("info", None) or self.info()
        return fr.build_command("ffmpeg", job, info)

    def graph(self, cmd):
        return cmd[cmd.index("-filter_complex") + 1]

    def test_crop_window_clamps(self):
        self.assertEqual(fr.crop_window(0.5, 1920, 1080), (657, 606))
        self.assertEqual(fr.crop_window(0, 1920, 1080)[0], 0)
        self.assertEqual(fr.crop_window(1, 1920, 1080)[0], 1920 - 606)
        self.assertEqual(fr.crop_window(None, 1920, 1080)[0], 657)
        self.assertEqual(fr.crop_window(-3, 1920, 1080)[0], 0)

    def test_full_169_is_only_scaled(self):
        c = self.cmd("full", [{"path": "/a.mp4", "start": 5, "end": 15}, {"path": "/a.mp4", "start": 30, "end": 40}])
        g = self.graph(c)
        self.assertIn("scale=1920:1080,setsar=1", g)
        self.assertNotIn("boxblur", g)
        self.assertIn("concat=n=2:v=1:a=0", g)
        self.assertIn("acrossfade=d=0.3", g)
        self.assertIn("loudnorm=I=-14", g)
        self.assertEqual(c.count("-i"), 2)
        self.assertEqual(c[c.index("-t", c.index("-map")) + 1], "20.000")

    def test_full_other_shape_is_blurred_fit(self):
        c = self.cmd("full", [{"path": "/a.mp4", "start": 0, "end": 5}], info=self.info(1080, 1920))
        g = self.graph(c)
        self.assertIn("boxblur", g)
        self.assertIn("force_original_aspect_ratio=decrease", g)

    def test_full_4k_and_1080p_option(self):
        i4 = self.info(3840, 2160)
        self.assertIn("scale=3840:2160", self.graph(self.cmd("full", [{"path": "/a.mp4", "start": 0, "end": 5}], info=i4)))
        self.assertIn("scale=1920:1080", self.graph(self.cmd("full", [{"path": "/a.mp4", "start": 0, "end": 5}], info=i4, size="1080p")))

    def test_reel_crop_and_portrait(self):
        c = self.cmd("reel", [{"path": "/a.mp4", "start": 0, "end": 5, "crop": {"x": 0}}])
        self.assertIn("crop=606:1080:0:0,scale=1080:1920", self.graph(c))
        c = self.cmd("reel", [{"path": "/a.mp4", "start": 0, "end": 5, "crop": {"x": 1}}])
        self.assertIn("crop=606:1080:1314:0", self.graph(c))
        c = self.cmd("reel", [{"path": "/a.mp4", "start": 0, "end": 5}], info=self.info(1080, 1920))
        self.assertNotIn("crop=", self.graph(c))
        self.assertIn("pad=1080:1920", self.graph(c))

    def test_fps_capped_and_input_clamped_to_source_end(self):
        c = self.cmd("full", [{"path": "/a.mp4", "start": 98, "end": 100}], info=self.info(fps=120, dur=100))
        self.assertIn("fps=60", self.graph(c))
        self.assertEqual(c[c.index("-t") + 1], "2.000")

    def test_rejects_empty_and_tiny(self):
        with self.assertRaises(RuntimeError):
            self.cmd("full", [])
        with self.assertRaises(RuntimeError):
            self.cmd("full", [{"path": "/a.mp4", "start": 1, "end": 1.05}])


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg missing")
class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="fw-test-")
        # 12 s video; audio = quiet noise + decaying bursts at 3 s and 8 s
        cls.clip = os.path.join(cls.dir, "clip.mp4")
        x = burst_signal([3.0, 8.0], total=12.0)
        wav = os.path.join(cls.dir, "a.raw")
        x.tofile(wav)
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=12",
                        "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", wav,
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", cls.clip], check=True)
        cls.silent = os.path.join(cls.dir, "silent.mp4")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2",
                        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", cls.silent], check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def job_file(self, obj):
        p = os.path.join(self.dir, "job.json")
        with open(p, "w") as f:
            json.dump(obj, f)
        return p

    def probe_streams(self, path):
        r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
        return r.stderr

    def test_analyse_done_event(self):
        ev = run_cap(fireworks.run_fireworks, self.job_file({"path": self.clip}), lambda: FFMPEG)
        done = [e for e in ev if e["type"] == "done"][0]
        self.assertAlmostEqual(done["duration"], 12.0, delta=0.3)
        self.assertEqual(done["rate"], 10)
        self.assertAlmostEqual(len(done["transient"]), 120, delta=4)
        self.assertEqual(len(done["rms"]), len(done["transient"]))
        self.assertEqual(len(done["low"]), len(done["transient"]))
        self.assertAlmostEqual(len(done["peaks"]) / 50, 12.0, delta=0.5)
        self.assertEqual((done["width"], done["height"]), (640, 360))
        self.assertGreaterEqual(max(done["transient"][29:34]), 200)
        self.assertGreaterEqual(max(done["transient"][79:84]), 200)
        self.assertEqual(ev[-1]["type"], "done")

    def test_no_audio_is_a_clear_error(self):
        ev = run_cap(fireworks.run_fireworks, self.job_file({"path": self.silent}), lambda: FFMPEG)
        self.assertEqual(ev[-1], {"type": "error", "message": "Dan il-video m'għandux ħoss."})

    def test_missing_file(self):
        ev = run_cap(fireworks.run_fireworks, self.job_file({"path": "/nope.mp4"}), lambda: FFMPEG)
        self.assertEqual(ev[-1]["type"], "error")

    def test_thumbs(self):
        out = os.path.join(self.dir, "thumbs")
        ev = run_cap(fireworks.run_thumbs, self.job_file({"path": self.clip, "times": [1, 5.5], "dir": out}), lambda: FFMPEG)
        self.assertEqual(ev[-1]["type"], "done")
        self.assertEqual(len(ev[-1]["files"]), 2)
        self.assertTrue(all(os.path.isfile(f) for f in ev[-1]["files"]))

    def duration_of(self, path):
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration,width,height",
                            "-of", "json", path], capture_output=True, text=True) if shutil.which("ffprobe") else None
        if r is None:
            return None
        return {s["codec_type"]: s for s in json.loads(r.stdout)["streams"]}

    def render(self, kind, items, name, **kw):
        out = os.path.join(self.dir, name)
        job = {"kind": kind, "output": out, "items": [{"path": self.clip, **i} for i in items], **kw}
        ev = run_cap(fr.run_fireworks_render, self.job_file(job), lambda: FFMPEG)
        # stdin is not a pipe here, so the watcher thread may mark the run cancelled; use render() directly
        return out, ev

    def test_reel_render_size_and_duration(self):
        out = os.path.join(self.dir, "reel.mp4")
        job = {"kind": "reel", "output": out, "items": [
            {"path": self.clip, "start": 1, "end": 4, "crop": {"x": 0.2}},
            {"path": self.clip, "start": 6, "end": 9.5, "crop": {"x": 0.8}},
            {"path": self.clip, "start": 10, "end": 11.5, "crop": None}]}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(fr.render(job, lambda: FFMPEG))
        s = self.duration_of(out)
        if s:
            self.assertEqual((int(s["video"]["width"]), int(s["video"]["height"])), (1080, 1920))
            v, a = float(s["video"]["duration"]), float(s["audio"]["duration"])
            self.assertAlmostEqual(v, 8.0, delta=0.15)
            self.assertAlmostEqual(a, 8.0, delta=0.15)
            self.assertAlmostEqual(v, a, delta=0.1)
        info = self.probe_streams(out)
        self.assertIn("1080x1920", info)
        self.assertIn("Audio: aac", info)
        import re
        m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", info)
        total = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        self.assertAlmostEqual(total, 8.0, delta=0.15)

    def test_full_render_is_169(self):
        out = os.path.join(self.dir, "full.mp4")
        job = {"kind": "full", "output": out, "items": [
            {"path": self.clip, "start": 0, "end": 2}, {"path": self.clip, "start": 5, "end": 7}]}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(fr.render(job, lambda: FFMPEG))
        self.assertIn("1920x1080", self.probe_streams(out))

    def test_chunked_render(self):
        out = os.path.join(self.dir, "chunked.mp4")
        old = fr.CHUNK
        fr.CHUNK = 2
        try:
            job = {"kind": "full", "output": out, "items": [
                {"path": self.clip, "start": s, "end": s + 1} for s in (0, 2, 4, 6, 8)]}
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertTrue(fr.render(job, lambda: FFMPEG))
        finally:
            fr.CHUNK = old
        import re
        info = self.probe_streams(out)
        m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", info)
        total = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        self.assertAlmostEqual(total, 5.0, delta=0.25)

    def test_cancel_removes_output(self):
        out = os.path.join(self.dir, "cancelled.mp4")
        job = {"kind": "full", "output": out, "items": [{"path": self.clip, "start": 0, "end": 5}]}
        box = {"cancel": True}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(fr.render(job, lambda: FFMPEG, box))
        self.assertFalse(os.path.exists(out))


def write_cube(path, n=5, warm=True, header="LUT_3D_SIZE"):
    with open(path, "w", encoding="utf-8") as f:
        f.write('TITLE "test"\n# comment\n')
        f.write(f"{header} {n}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n")
        for b in range(n):
            for g in range(n):
                for r in range(n):
                    R, G, B = r / (n - 1), g / (n - 1), b / (n - 1)
                    if warm:
                        R, B = min(1.0, R * 1.3 + 0.1), B * 0.5
                    f.write(f"{R:.6f} {G:.6f} {B:.6f}\n")


class LutTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fw-lut-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_check_cube(self):
        p = os.path.join(self.dir, "ok.cube")
        write_cube(p, 5)
        self.assertEqual(lutmod.check_cube(p), 5)
        one = os.path.join(self.dir, "one.cube")
        write_cube(one, 5, header="LUT_1D_SIZE")
        with self.assertRaisesRegex(RuntimeError, "1D"):
            lutmod.check_cube(one)
        bad = os.path.join(self.dir, "bad.cube")
        with open(bad, "w") as f:
            f.write("hello\n")
        with self.assertRaises(RuntimeError):
            lutmod.check_cube(bad)
        with self.assertRaises(RuntimeError):
            lutmod.check_cube(os.path.join(self.dir, "missing.cube"))

    def test_stage_copies_to_a_plain_name_and_chain(self):
        odd = os.path.join(self.dir, "Proġetti Code", "S-Log3 'to' 709.cube")
        os.makedirs(os.path.dirname(odd))
        write_cube(odd, 5)
        work = tempfile.mkdtemp(prefix="fw-work-")
        try:
            st = lutmod.stage({"path": odd, "strength": 1}, work)
            self.assertTrue(lutmod.SAFE.match(st[0]))
            self.assertEqual(lutmod.chain(st, 1), f"lut3d=file={st[0]}:interp=tetrahedral")
            half = lutmod.stage({"path": odd, "strength": 0.4}, work)
            c = lutmod.chain(half, 2)
            self.assertIn("all_opacity=0.400", c)
            self.assertIn("[lo2]", c)
            self.assertIsNone(lutmod.stage({"path": odd, "strength": 0}, work))
            self.assertIsNone(lutmod.stage(None, work))
            self.assertEqual(lutmod.chain(None), "")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def test_graph_applies_lut_before_crop(self):
        job = {"kind": "reel", "output": "/out.mp4", "_lut": ("/tmp/x/lut.cube", 1.0),
               "items": [{"path": "/a.mp4", "start": 0, "end": 3, "crop": {"x": 0.5}}]}
        cmd = fr.build_command("ffmpeg", job, {"/a.mp4": {"dur": 10, "w": 1920, "h": 1080, "fps": 30}})
        g = cmd[cmd.index("-filter_complex") + 1]
        self.assertLess(g.index("lut3d"), g.index("crop="))


class LutRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="fw-lutr-")
        cls.clip = os.path.join(cls.dir, "grey clip.mp4")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x808080:s=640x360:r=25:d=4",
                        "-f", "lavfi", "-i", "anoisesrc=d=4:a=0.1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-shortest", cls.clip], check=True)
        cls.cube = os.path.join(cls.dir, "Warm ġ look.cube")
        write_cube(cls.cube, 9)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def mean_rgb(self, path, at=1.0):
        r = subprocess.run([FFMPEG, "-v", "error", "-ss", str(at), "-i", path, "-frames:v", "1",
                            "-vf", "scale=32:18", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
        a = np.frombuffer(r.stdout, dtype=np.uint8).reshape(-1, 3).astype(float)
        return a.mean(axis=0)

    def thumb(self, lut):
        out = os.path.join(self.dir, f"th-{len(os.listdir(self.dir))}")
        job = os.path.join(self.dir, "tjob.json")
        with open(job, "w") as f:
            json.dump({"path": self.clip, "times": [1.0], "dir": out, "lut": lut}, f)
        ev = run_cap(fireworks.run_thumbs, job, lambda: FFMPEG)
        self.assertEqual(ev[-1]["type"], "done", ev)
        return self.mean_rgb(ev[-1]["files"][0], 0)

    def test_thumbs_follow_lut_and_strength(self):
        plain = self.thumb(None)
        full = self.thumb({"path": self.cube, "strength": 1})
        half = self.thumb({"path": self.cube, "strength": 0.5})
        self.assertGreater(full[0] - full[2], 40)            # warm: red well above blue
        self.assertLess(abs(plain[0] - plain[2]), 8)         # grey stays grey
        self.assertTrue(plain[0] < half[0] < full[0])        # half strength sits between

    def test_render_with_lut(self):
        out = os.path.join(self.dir, "reel lut.mp4")
        job = {"kind": "full", "output": out, "lut": {"path": self.cube, "strength": 0.6},
               "items": [{"path": self.clip, "start": 0.5, "end": 3.0}]}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(fr.render(job, lambda: FFMPEG))
        m = self.mean_rgb(out, 1.0)
        self.assertGreater(m[0] - m[2], 20)

    def test_bad_lut_is_a_clear_error(self):
        bad = os.path.join(self.dir, "flat.cube")
        write_cube(bad, 5, header="LUT_1D_SIZE")
        job = {"kind": "full", "output": os.path.join(self.dir, "x.mp4"), "lut": {"path": bad, "strength": 1},
               "items": [{"path": self.clip, "start": 0.5, "end": 2.0}]}
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "1D"):
                fr.render(job, lambda: FFMPEG)


if __name__ == "__main__":
    unittest.main()
