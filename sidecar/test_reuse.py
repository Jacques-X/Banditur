"""The vendored RE-USE network (reuse_mlx) on MLX: the recurrence, the checkpoint layout and shapes.
Skipped where MLX is missing. The real weights are NOT in the repo (downloaded on first use), so these tests use
a small network of the same architecture; the full-size network is only built to count its parameters."""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

import numpy as np

try:
    import mlx.core as mx
    from mlx.utils import tree_flatten
    HAVE_MLX = True
except ImportError:
    HAVE_MLX = False

if HAVE_MLX:
    from reuse_mlx import Model, load_model
    from reuse_mlx.config import ModelConfig
    from reuse_mlx.mamba import selective_scan

import awdjo
import awdjo_chunks as ch

NVIDIA_CONFIG = {
    "model_cfg": {"beta": 2.0, "compress_factor": "relu_log1p", "d_conv": 4, "d_state": 16, "expand": 4, "hid_feature": 64,
                  "inner_mamba_nlayer": 1, "input_channel": 2, "mapping": True, "nonlinear": "None", "norm_epsilon": 1e-05,
                  "num_tfmamba": 30, "output_channel": 1},
    "stft_cfg": {"hop_size": 40, "n_fft": 320, "sampling_rate": 8000, "sfi": True, "win_size": 320},
}


def tiny_config():
    return ModelConfig(hid_feature=4, num_tfmamba=1, d_state=3, expand=2)


@unittest.skipUnless(HAVE_MLX, "MLX missing")
class ReuseTests(unittest.TestCase):
    def test_nvidia_config_is_read(self):
        cfg = ModelConfig.from_dict(NVIDIA_CONFIG)
        self.assertEqual((cfg.hid_feature, cfg.num_tfmamba, cfg.sampling_rate, cfg.compress_factor), (64, 30, 8000, "relu_log1p"))
        self.assertEqual(cfg.stft_sizes(48000), (1920, 240, 1920))
        self.assertEqual(cfg.stft_sizes(22050), (882, 110, 882))

    def test_full_size_network_has_the_published_parameter_count(self):
        n = sum(v.size for _, v in tree_flatten(Model(ModelConfig.from_dict(NVIDIA_CONFIG)).parameters()))
        self.assertAlmostEqual(n / 1e6, 9.6, delta=0.05)           # model card: 9.6M

    def test_selective_scan_matches_a_numpy_recurrence(self):
        rng = np.random.default_rng(13)
        batch, length, channels, states = 2, 19, 7, 3
        x = rng.normal(size=(batch, length, channels)).astype(np.float32)
        dt = rng.uniform(0, 0.3, size=x.shape).astype(np.float32)
        a = -rng.uniform(0.1, 2, size=(channels, states)).astype(np.float32)
        b, c = rng.normal(size=(2, batch, length, states)).astype(np.float32)
        d = rng.normal(size=channels).astype(np.float32)
        state = np.zeros((batch, channels, states), dtype=np.float64)
        expected = []
        for i in range(length):
            delta = dt[:, i, :, None]
            state = np.exp(delta * a) * state + delta * b[:, i, None] * x[:, i, :, None]
            expected.append((state * c[:, i, None]).sum(-1) + d * x[:, i])
        with mx.stream(mx.cpu):
            got = selective_scan(*map(mx.array, (x, dt, a, b, c, d)))
            mx.eval(got)
        np.testing.assert_allclose(np.array(got), np.stack(expected, 1), atol=2e-6, rtol=2e-5)

    def test_clip_in_clip_out_for_any_length_and_rate(self):
        model = Model(tiny_config())
        model.eval()
        rng = np.random.default_rng(1)
        for rate, length in ((8000, 100), (16000, 4000), (44100, 9001), (48000, 2000)):
            x = rng.normal(0, 0.1, length).astype(np.float32)
            y = np.array(model.enhance_chunk(mx.array(x), rate))
            self.assertEqual(y.shape, x.shape)
            self.assertTrue(np.isfinite(y).all())

    def test_nvidia_layout_checkpoint_loads_strictly(self):
        cfg = tiny_config()
        model = Model(cfg)
        native = dict(tree_flatten(model.parameters()))
        # NVIDIA's file is PyTorch layout: conv weights channels-first, Conv1d [out, in/groups, k]
        source = {k: (v.transpose(0, 3, 1, 2) if v.ndim == 4 else v.transpose(0, 2, 1) if k.endswith("conv1d.weight") else v)
                  for k, v in native.items()}
        d = tempfile.mkdtemp(prefix="reuse-test-")
        try:
            raw = {"model_cfg": {**NVIDIA_CONFIG["model_cfg"], "hid_feature": 4, "num_tfmamba": 1, "d_state": 3, "expand": 2},
                   "stft_cfg": NVIDIA_CONFIG["stft_cfg"]}
            with open(os.path.join(d, "config.json"), "w") as f:
                json.dump(raw, f)
            mx.save_safetensors(os.path.join(d, "model.safetensors"), source)
            loaded = load_model(d)
            for k, v in tree_flatten(loaded.parameters()):
                np.testing.assert_array_equal(np.array(v), np.array(native[k]))
            # a file with a missing weight is refused, not half-loaded
            broken = dict(source)
            broken.pop(next(iter(broken)))
            mx.save_safetensors(os.path.join(d, "model.safetensors"), broken)
            with self.assertRaises(Exception):
                load_model(d)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_whole_pipeline_with_the_network_chunked_and_unchunked(self):
        net = Model(tiny_config())
        net.eval()
        model = awdjo.MlxEnhancer(net, mx)
        rate = 8000
        x = np.random.default_rng(2).normal(0, 0.1, rate * 12).astype(np.float32)
        chunked = ch.enhance_channel(x, rate, lambda c: model.enhance_chunk(c, rate), chunk_seconds=4.0, overlap_seconds=2.0)
        whole = model.enhance_chunk(x, rate)
        self.assertEqual(chunked.shape, x.shape)
        self.assertTrue(np.isfinite(chunked).all() and np.isfinite(whole).all())
        self.assertEqual(whole.shape, x.shape)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg missing")
    def test_job_loads_the_checkpoint_from_the_model_folder_and_writes_a_file(self):
        d = tempfile.mkdtemp(prefix="reuse-job-")
        try:
            net = Model(tiny_config())
            native = dict(tree_flatten(net.parameters()))
            source = {k: (v.transpose(0, 3, 1, 2) if v.ndim == 4 else v.transpose(0, 2, 1) if k.endswith("conv1d.weight") else v)
                      for k, v in native.items()}
            mdir = os.path.join(d, "model")
            os.makedirs(mdir)
            with open(os.path.join(mdir, "config.json"), "w") as f:
                json.dump({"model_cfg": {**NVIDIA_CONFIG["model_cfg"], "hid_feature": 4, "num_tfmamba": 1, "d_state": 3, "expand": 2},
                           "stft_cfg": NVIDIA_CONFIG["stft_cfg"]}, f)
            mx.save_safetensors(os.path.join(mdir, "model.safetensors"), source)
            src = os.path.join(d, "a.mov")
            ff = shutil.which("ffmpeg")
            import subprocess
            subprocess.run([ff, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24:duration=3",
                            "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=16000:duration=3", "-c:v", "mjpeg", "-c:a", "pcm_s16le", src], check=True)
            out = os.path.join(d, "a (nadif).mov")
            with contextlib.redirect_stdout(io.StringIO()):
                res = awdjo.process({"path": src, "output": out, "model_dir": mdir, "strength": 1.0}, lambda: ff, awdjo.Job())
            self.assertTrue(os.path.isfile(out))
            self.assertEqual((res["rate"], res["channels"], res["samples"]), (16000, 1, 48000))
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
