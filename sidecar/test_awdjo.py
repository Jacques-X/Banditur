"""Awdjo: chunk planning, overlap-add, channel handling, the ffmpeg command, and end-to-end runs on synthetic clips
with a stand-in model (the real RE-USE network is tested in test_reuse.py)."""
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import contextlib

import numpy as np

import awdjo
import awdjo_chunks as ch

FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
HAVE_FFMPEG = os.path.isfile(FFMPEG)


class FakeModel:
    """Halves the level: enough to tell enhanced sound from the original."""
    def __init__(self, gain=0.5):
        self.gain = gain
        self.calls = 0

    def enhance_chunk(self, clip, rate):
        self.calls += 1
        return (np.asarray(clip) * self.gain).astype(np.float32)


class ChunkTests(unittest.TestCase):
    def test_short_audio_is_one_pass(self):
        self.assertEqual(ch.plan_chunks(48000 * 3, 48000), (48000 * 3, [0]))
        self.assertEqual(ch.plan_chunks(48000 * 5, 48000), (48000 * 5, [0]))

    def test_plan_covers_every_sample_with_fixed_size_chunks(self):
        for length in (5 * 16000 + 1, 12 * 16000 + 123, 61 * 16000, 600 * 16000 + 7):
            chunk, starts = ch.plan_chunks(length, 16000)
            self.assertEqual(chunk, 5 * 16000)
            self.assertEqual(starts[0], 0)
            self.assertEqual(starts[-1] + chunk, length)
            self.assertTrue(all(b > a for a, b in zip(starts, starts[1:])))
            self.assertTrue(all(b - a <= chunk - 2.5 * 16000 + 1 for a, b in zip(starts, starts[1:])))   # always overlapping

    def test_bad_plans_are_refused(self):
        with self.assertRaises(ValueError):
            ch.plan_chunks(0, 16000)
        with self.assertRaises(ValueError):
            ch.plan_chunks(100000, 16000, 5.0, 5.0)

    def test_overlap_add_of_identity_returns_the_input(self):
        rng = np.random.default_rng(3)
        for length in (1000, 8000 * 5, 8000 * 5 + 1, 8000 * 23 + 17):
            x = rng.normal(0, 0.2, length).astype(np.float32)
            y = ch.enhance_channel(x, 8000, lambda c: c)
            self.assertEqual(y.shape, x.shape)
            np.testing.assert_allclose(y, x, atol=2e-6)

    def test_overlap_add_crossfades_two_different_chunks(self):
        rate = 8000
        x = np.ones(rate * 10, dtype=np.float32)
        calls = []

        def one(c):
            calls.append(len(c))
            return c * (len(calls))          # chunk k scales by k
        y = ch.enhance_channel(x, rate, one)
        self.assertTrue(np.isfinite(y).all())
        self.assertGreaterEqual(y.min(), 1.0 - 1e-5)
        self.assertLessEqual(y.max(), len(calls) + 1e-5)
        self.assertEqual(set(calls), {rate * 5})

    def test_progress_and_cancel(self):
        x = np.zeros(8000 * 20, dtype=np.float32)
        seen = []
        ch.enhance_channel(x, 8000, lambda c: c, on_chunk=lambda i, n: seen.append((i, n)))
        self.assertEqual(seen[-1][0], seen[-1][1])
        self.assertEqual(seen[-1][1], ch.chunk_count(len(x), 8000))
        stop = []
        out = ch.enhance_channel(x, 8000, lambda c: (stop.append(1), c)[1], cancelled=lambda: len(stop) >= 2)
        self.assertIsNone(out)

    def test_working_rate(self):
        for r in ch.SUPPORTED_RATES:
            self.assertEqual(ch.working_rate(r), r)
        for r in (11025, 12000, 88200, 96000, 192000):
            self.assertEqual(ch.working_rate(r), 48000)
        self.assertEqual(ch.working_rate(44100, "mxf"), 48000)

    def test_channels_of(self):
        self.assertEqual(ch.channels_of("mono"), 1)
        self.assertEqual(ch.channels_of("stereo"), 2)
        self.assertEqual(ch.channels_of("5.1(side)"), 6)
        self.assertEqual(ch.channels_of("4 channels"), 4)
        self.assertEqual(ch.channels_of("3 channels (FL+FR+LFE)"), 3)
        self.assertIsNone(ch.channels_of("weird"))

    def test_mix_and_fit(self):
        dry = np.array([0.2, -0.2, 1.0], dtype=np.float32)
        wet = np.array([0.0, 0.0, 2.0], dtype=np.float32)
        np.testing.assert_allclose(ch.mix(dry, wet, 1.0), [0, 0, 1.0])
        np.testing.assert_allclose(ch.mix(dry, wet, 0.0), dry)
        np.testing.assert_allclose(ch.mix(dry, wet, 0.5), [0.1, -0.1, 1.0])
        self.assertEqual(len(ch.fit_length(dry, 5)), 5)
        self.assertEqual(len(ch.fit_length(dry, 2)), 2)
        self.assertEqual(ch.fit_length(dry, 3) is dry, True)


STEREO_INFO = """Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':
  Duration: 00:00:10.04, start: 0.000000, bitrate: 25000 kb/s
    Stream #0:0(eng): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 24 fps
    Stream #0:1(eng): Audio: pcm_s24le (in24 / 0x34326E69), 48000 Hz, stereo, s32, 2304 kb/s
"""


class FfmpegTextTests(unittest.TestCase):
    def test_inspect(self):
        f = awdjo.inspect_text(STEREO_INFO)
        self.assertEqual(f["audio"]["rate"], 48000)
        self.assertEqual(f["audio"]["channels"], 2)
        self.assertTrue(f["has_video"])
        self.assertEqual(f["start"], 0.0)

    def test_inspect_audio_only_with_cover_art_and_start(self):
        info = """  Duration: 00:03:00.00, start: 0.025057, bitrate: 320 kb/s
    Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 320 kb/s
    Stream #0:1: Video: mjpeg (Baseline), yuvj420p, 500x500, 90k tbr (attached pic)
"""
        f = awdjo.inspect_text(info)
        self.assertEqual((f["audio"]["rate"], f["audio"]["channels"]), (44100, 1))
        self.assertFalse(f["has_video"])
        self.assertAlmostEqual(f["start"], 0.025057)

    def test_inspect_without_sound(self):
        self.assertIsNone(awdjo.inspect_text("    Stream #0:0: Video: h264, 1280x720\n")["audio"])

    def test_mux_command_copies_the_picture_and_keeps_metadata(self):
        c = awdjo.mux_args("ffmpeg", "/in.mov", "/w/clean.f32", 48000, 2, "/out.mov.partial", "mov", True)
        s = " ".join(c)
        self.assertIn("-c:v copy", s)
        self.assertIn("-c:a pcm_s24le", s)
        self.assertIn("-map_metadata 0", s)
        self.assertIn("use_metadata_tags", s)
        self.assertIn("-f mov /out.mov.partial", s)
        self.assertNotIn("-itsoffset", s)
        self.assertEqual(c[c.index("-i") + 1], "/in.mov")

    def test_mp4_gets_aac_320(self):
        for ext in ("mp4", "m4v"):
            s = " ".join(awdjo.mux_args("ffmpeg", "/a.mp4", "/r", 44100, 1, "/o.partial", ext, True))
            self.assertIn("-c:a aac -b:a 320k", s)
            self.assertIn("-f mp4", s)
            self.assertNotIn("pcm", s)

    def test_mxf_and_wav_are_pcm_and_wav_has_no_picture(self):
        self.assertIn("-f mxf", " ".join(awdjo.mux_args("f", "/a.mxf", "/r", 48000, 2, "/o", "mxf", True)))
        w = " ".join(awdjo.mux_args("f", "/a.mp3", "/r", 44100, 1, "/o", "wav", False))
        self.assertIn("-vn", w)
        self.assertNotIn("-c:v", w)

    def test_offset_only_when_audio_starts_late(self):
        s = " ".join(awdjo.mux_args("f", "/a.mp4", "/r", 48000, 2, "/o", "mp4", True, 0.021333))
        self.assertIn("-itsoffset 0.021333", s)

    def test_no_user_path_in_a_filter_graph(self):
        c = awdjo.mux_args("f", "/a b/'x'.mov", "/r", 48000, 2, "/o", "mov", True)
        self.assertNotIn("-filter_complex", c)
        self.assertNotIn("-af", c)


def sh(*args):
    return subprocess.run(list(args), capture_output=True, text=True, errors="replace")


def make_clip(path, ext, secs=12, rate=44100, layout="stereo", video=True):
    """A synthetic clip: test picture + a noisy tone; returns the ffmpeg result."""
    cmd = [FFMPEG, "-y", "-v", "error"]
    if video:
        cmd += ["-f", "lavfi", "-i", f"testsrc=size=160x90:rate=24:duration={secs}"]
    cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate={rate}:duration={secs}"]
    if layout == "stereo":
        cmd += ["-af", "pan=stereo|c0=c0|c1=0.5*c0"]
    elif layout == "mono":
        cmd += ["-ac", "1"]
    if video:
        cmd += ["-c:v", "mpeg4" if ext in ("mp4", "m4v") else "mjpeg", "-q:v", "5"]
        cmd += ["-c:a", "aac" if ext in ("mp4", "m4v") else "pcm_s16le"]
    else:
        cmd += ["-c:a", "pcm_s16le"]
    if ext == "mxf":
        cmd = [FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc=size=720x576:rate=25:duration={secs}",
               "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=%d" % secs, "-af", "pan=stereo|c0=c0|c1=c0",
               "-c:v", "mpeg2video", "-q:v", "3", "-c:a", "pcm_s24le"]
    cmd.append(path)
    return sh(*cmd)


def info_of(path):
    return sh(FFMPEG, "-hide_banner", "-i", path).stderr


def sample_count(path):
    r = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le", "pipe:1"], capture_output=True)
    return len(r.stdout) // 4


def digest(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run_job(src, out, strength=1.0, model=None, cancel_after=None):
    job = awdjo.Job()
    data = {"path": src, "output": out, "strength": strength}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        res = awdjo.process(data, lambda: FFMPEG, job, model=model or FakeModel())
    return res, [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg missing")
class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="awdjo-test-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def p(self, name):
        return os.path.join(self.dir, name)

    def check_clean(self, src, out, codec, vcodec):
        i = info_of(out)
        self.assertRegex(i, r"Audio: " + codec)
        self.assertRegex(i, r"Video: " + vcodec)
        self.assertEqual(sample_count(out), sample_count(src))        # the sound is exactly as long as the original's
        self.assertFalse(os.path.exists(out + ".partial"))

    def test_mov_stereo_pcm24_and_original_untouched(self):
        src = self.p("a b.mov")
        r = make_clip(src, "mov", rate=44100)
        self.assertEqual(r.returncode, 0, r.stderr)
        before = digest(src)
        out = self.p("a b (nadif).mov")
        model = FakeModel()
        res, events = run_job(src, out, model=model)
        self.assertEqual(digest(src), before)
        self.check_clean(src, out, "pcm_s24le", "mjpeg")
        self.assertIn("44100 Hz, stereo", info_of(out))
        self.assertEqual(res["rate"], 44100)
        self.assertEqual(res["channels"], 2)
        self.assertEqual(model.calls, 2 * len(ch.plan_chunks(res["samples"], 44100)[1]))   # each channel on its own
        self.assertEqual(events[-1]["type"], "progress")
        self.assertEqual([e["value"] for e in events if e["type"] == "progress"], sorted(e["value"] for e in events if e["type"] == "progress"))

    def test_the_sound_is_really_replaced_and_strength_blends(self):
        src = self.p("t.mov")
        make_clip(src, "mov", secs=3, rate=48000, layout="mono")
        def rms(path):
            r = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le", "pipe:1"], capture_output=True)
            a = np.frombuffer(r.stdout, dtype="<f4")
            return float(np.sqrt(np.mean(a ** 2)))
        full, half, none = self.p("full.mov"), self.p("half.mov"), self.p("none.mov")
        run_job(src, full, 1.0)
        run_job(src, half, 0.5)
        run_job(src, none, 0.0)
        r0 = rms(src)
        self.assertAlmostEqual(rms(full) / r0, 0.5, delta=0.03)       # the stand-in halves the level
        self.assertAlmostEqual(rms(half) / r0, 0.75, delta=0.03)
        self.assertAlmostEqual(rms(none) / r0, 1.0, delta=0.03)

    def test_mp4_gets_aac_and_keeps_its_rate(self):
        src = self.p("c.mp4")
        r = make_clip(src, "mp4", rate=32000, layout="mono")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = self.p("c (nadif).mp4")
        res, _ = run_job(src, out)
        self.assertRegex(info_of(out), r"Audio: aac")
        self.assertIn("32000 Hz, mono", info_of(out))
        self.assertEqual(res["rate"], 32000)
        self.assertRegex(info_of(out), r"Video: mpeg4")
        # AAC adds encoder padding; the duration still matches
        self.assertAlmostEqual(sample_count(out) / 32000, sample_count(src) / 32000, delta=0.07)

    def test_unsupported_rate_goes_to_48k(self):
        src = self.p("d.mov")
        make_clip(src, "mov", secs=4, rate=11025, layout="mono")
        out = self.p("d (nadif).mov")
        res, _ = run_job(src, out)
        self.assertEqual(res["rate"], 48000)
        self.assertIn("48000 Hz", info_of(out))
        self.assertAlmostEqual(sample_count(out) / 48000, 4.0, delta=0.05)

    def test_audio_only_becomes_wav(self):
        src = self.p("e.wav")
        make_clip(src, "wav", secs=3, rate=22050, layout="mono", video=False)
        out = self.p("e (nadif).wav")
        run_job(src, out)
        self.assertRegex(info_of(out), r"pcm_s24le")
        self.assertEqual(sample_count(out), sample_count(src))

    def test_mxf(self):
        src = self.p("f.mxf")
        r = make_clip(src, "mxf", secs=3)
        if r.returncode != 0:
            self.skipTest("this ffmpeg cannot write MXF")
        out = self.p("f (nadif).mxf")
        run_job(src, out)
        self.assertRegex(info_of(out), r"Audio: pcm_s24le")
        self.assertEqual(sample_count(out), sample_count(src))

    def test_refuses_to_overwrite_or_to_write_on_the_original(self):
        src = self.p("g.mov")
        make_clip(src, "mov", secs=2)
        out = self.p("g (nadif).mov")
        with open(out, "wb") as f:
            f.write(b"mine")
        with self.assertRaises(RuntimeError):
            run_job(src, out)
        with open(out, "rb") as f:
            self.assertEqual(f.read(), b"mine")
        with self.assertRaises(RuntimeError):
            run_job(src, src)

    def test_no_sound_and_missing_model(self):
        src = self.p("h.mov")
        sh(FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24:duration=2", "-c:v", "mjpeg", src)
        with self.assertRaises(RuntimeError) as c:
            run_job(src, self.p("h (nadif).mov"))
        self.assertEqual(str(c.exception), awdjo.NO_AUDIO)
        src2 = self.p("i.mov")
        make_clip(src2, "mov", secs=2)
        job = awdjo.Job()
        with self.assertRaises(RuntimeError) as c, contextlib.redirect_stdout(io.StringIO()):
            awdjo.process({"path": src2, "output": self.p("i (nadif).mov"), "model_dir": self.p("nope")}, lambda: FFMPEG, job)
        self.assertEqual(str(c.exception), awdjo.NO_MODEL)

    def test_cancel_leaves_nothing_behind(self):
        src = self.p("j.mov")
        make_clip(src, "mov", secs=30, rate=16000, layout="mono")
        out = self.p("j (nadif).mov")
        job = awdjo.Job()

        class Cancelling(FakeModel):
            def enhance_chunk(s, clip, rate):
                job.cancel.set()
                return super().enhance_chunk(clip, rate)
        with self.assertRaises(awdjo.Stop), contextlib.redirect_stdout(io.StringIO()):
            awdjo.process({"path": src, "output": out, "strength": 1}, lambda: FFMPEG, job, model=Cancelling())
        self.assertEqual(sorted(os.listdir(self.dir)), ["j.mov"])

    def test_run_awdjo_reports_errors_as_events(self):
        jp = self.p("job.json")
        with open(jp, "w") as f:
            json.dump({"path": self.p("none.mov"), "output": self.p("x (nadif).mov")}, f)
        buf = io.StringIO()
        old = sys.stdin
        r, w = os.pipe()
        sys.stdin = os.fdopen(r)
        try:
            with contextlib.redirect_stdout(buf):
                awdjo.run_awdjo(jp, lambda: FFMPEG)
        finally:
            os.close(w)
            sys.stdin = old
        events = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
        self.assertEqual(events[-1], {"type": "error", "message": "Il-fajl ma nstabx."})
        self.assertFalse(os.path.exists(jp))


if __name__ == "__main__":
    unittest.main()
