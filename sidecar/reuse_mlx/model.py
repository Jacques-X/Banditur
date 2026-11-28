# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: OpenMDW-1.1
# Adapted for MLX from NVIDIA-NemotronLabs-RE-USE (via mlx-audio, MIT; see LICENSE-mlx-audio.txt).
# Banditur: `generate()`, file/array handling and resampling were removed (awdjo.py does the audio
# I/O with ffmpeg and awdjo_chunks.py the chunking); `load_model()` reads NVIDIA's checkpoint from a folder.
"""RE-USE speech enhancement at 8-48 kHz: one clip of a few seconds per call."""

import json
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn

from .config import ModelConfig
from .dsp import istft, stft
from .mamba import TFMambaBlock
from .network import Decoder, DenseEncoder


class Model(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.dense_encoder = DenseEncoder(config)
        self.TSMamba = [TFMambaBlock(config) for _ in range(config.num_tfmamba)]
        self.mask_decoder = Decoder(config)
        self.phase_decoder = Decoder(config, phase=True)

    def __call__(self, magnitude, phase):
        """Map compressed magnitude and phase [batch, frequency, time]."""
        freq, time = magnitude.shape[-2:]
        x = mx.stack([magnitude, phase], axis=-1).transpose(0, 2, 1, 3)
        x = mx.pad(x, ((0, 0), (0, 2), (0, 2), (0, 0)))
        x = self.dense_encoder(x)
        for block in self.TSMamba:
            x = block(x)
        magnitude = self.mask_decoder(x)[:, :time, :freq, 0].transpose(0, 2, 1)
        phase = self.phase_decoder(x)[:, :time, :freq, 0].transpose(0, 2, 1)
        return magnitude, phase

    def sanitize(self, weights):
        """NVIDIA's checkpoint is channels-first (PyTorch); MLX convolutions are channels-last."""
        key = "dense_encoder.dense_conv_1.0.weight"
        if (
            key not in weights
            or weights[key].shape == self.dense_encoder.dense_conv_1[0].weight.shape
        ):
            return weights
        return {
            key: (
                value.transpose(0, 2, 3, 1)
                if value.ndim == 4
                else (
                    value.transpose(0, 2, 1) if key.endswith("conv1d.weight") else value
                )
            )
            for key, value in weights.items()
        }

    def enhance_chunk(self, audio, sample_rate):
        """Enhance one mono clip (mx.array, float32 in [-1, 1]) of any length; same length out."""
        length = audio.shape[0]
        n_fft, hop, win = self.config.stft_sizes(sample_rate)
        # Reflection padding needs more than half an FFT of input.
        if length <= n_fft // 2:
            audio = mx.pad(audio, ((0, n_fft // 2 + 1 - length),))
        window = 0.5 - 0.5 * mx.cos(2 * mx.pi * mx.arange(win) / win)
        spectrum = stft(audio, n_fft, hop, win, window=window).T
        magnitude = mx.abs(spectrum)
        compression = self.config.compress_factor
        if compression in ("log1p", "relu_log1p", "signed_log1p"):
            magnitude = mx.log1p(magnitude)
        else:
            magnitude = magnitude**compression
        # Real FFT endpoints can contain -0j in MLX. PyTorch returns +0j;
        # feeding -pi instead of +pi into the network changes its prediction.
        imaginary = mx.where(spectrum.imag == 0, 0.0, spectrum.imag)
        phase = mx.arctan2(imaginary, spectrum.real)
        magnitude, phase = self(magnitude[None], phase[None])
        magnitude, phase = magnitude[0], phase[0]
        # Match the released inference script's sweep-artifact suppression.
        silent = mx.mean((magnitude <= 0).astype(mx.float32), axis=0) > 0.5
        magnitude = mx.where(silent[None], 0, magnitude)
        if compression == "relu_log1p":
            magnitude = mx.expm1(nn.relu(magnitude))
        elif compression == "log1p":
            magnitude = mx.expm1(magnitude)
        elif compression == "signed_log1p":
            magnitude = mx.sign(magnitude) * mx.expm1(mx.abs(magnitude))
        else:
            magnitude = nn.relu(magnitude) ** (1 / compression)
        spectrum = magnitude * (mx.cos(phase) + 1j * mx.sin(phase))
        enhanced = istft(spectrum, hop, win, window=window, normalized=True)
        if enhanced.shape[0] < length:
            enhanced = mx.pad(
                enhanced, ((0, length - enhanced.shape[0]),), constant_values=1e-8
            )
        return enhanced[:length]


def load_model(model_dir):
    """Build the model from `<dir>/config.json` + `<dir>/model.safetensors` (NVIDIA's files), strictly."""
    folder = Path(model_dir)
    raw = json.loads((folder / "config.json").read_text(encoding="utf-8"))
    model = Model(ModelConfig.from_dict(raw))
    weights = model.sanitize(mx.load(str(folder / "model.safetensors")))
    model.load_weights(list(weights.items()), strict=True)
    mx.eval(model.parameters())
    model.eval()
    return model
