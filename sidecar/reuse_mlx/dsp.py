# Copyright (c) 2024 Prince Canuma (MLX Audio, MIT License; see LICENSE-mlx-audio.txt).
# Only stft() and istft() are taken from mlx_audio/dsp.py (commit 93cfb9ff82c1); the window
# is always passed as an array, so the by-name window table is left out.
"""STFT / inverse STFT on MLX arrays, as used by the RE-USE model."""

import mlx.core as mx


def stft(
    x,
    n_fft=800,
    hop_length=None,
    win_length=None,
    window=None,
    center=True,
    pad_mode="reflect",
):
    if hop_length is None:
        hop_length = n_fft // 4
    if win_length is None:
        win_length = n_fft

    w = window

    if w.shape[0] < n_fft:
        padding = n_fft - w.shape[0]
        w = mx.pad(w, [(padding // 2, padding - padding // 2)])

    def _pad(x, padding, pad_mode="reflect"):
        if pad_mode == "constant":
            return mx.pad(x, [(padding, padding)])
        elif pad_mode == "reflect":
            prefix = x[1 : padding + 1][::-1]
            suffix = x[-(padding + 1) : -1][::-1]
            return mx.concatenate([prefix, x, suffix])
        else:
            raise ValueError(f"Invalid pad_mode {pad_mode}")

    if center:
        x = _pad(x, n_fft // 2, pad_mode)

    num_frames = 1 + (x.shape[0] - n_fft) // hop_length
    if num_frames <= 0:
        raise ValueError(
            f"Input is too short (length={x.shape[0]}) for n_fft={n_fft} with hop_length={hop_length} and center={center}."
        )

    shape = (num_frames, n_fft)
    strides = (hop_length, 1)
    frames = mx.as_strided(x, shape=shape, strides=strides)
    return mx.fft.rfft(frames * w)


def istft(
    x,
    hop_length=None,
    win_length=None,
    window=None,
    center=True,
    length=None,
    normalized=False,
):
    """Inverse Short-Time Fourier Transform.

    Args:
        x: Complex STFT output of shape (n_fft // 2 + 1, num_frames)
        hop_length: Hop length between frames (default: win_length // 4)
        win_length: Window length (default: FFT size inferred from the frequency axis)
        window: Window as an array (required)
        center: If True, remove center padding (default: True)
        length: Target output length (default: None)
        normalized: If True, divide the overlap-add by the summed squared
            window (least-squares inversion, the division torch.istft always
            performs). If False, divide by the summed window (default: False).
            Note this is unrelated to torch.istft's `normalized` argument,
            which selects FFT scaling.

    Returns:
        Reconstructed time-domain signal
    """
    n_fft = (x.shape[0] - 1) * 2
    if win_length is None:
        win_length = n_fft
    if hop_length is None:
        hop_length = win_length // 4

    w = window

    if w.shape[0] < n_fft:
        padding = n_fft - w.shape[0]
        w = mx.pad(w, [(padding // 2, padding - padding // 2)])

    num_frames = x.shape[1]
    t = (num_frames - 1) * hop_length + n_fft

    reconstructed = mx.zeros(t)
    window_sum = mx.zeros(t)

    # inverse FFT of each frame
    frames_time = mx.fft.irfft(x, axis=0).transpose(1, 0)

    # get the position in the time-domain signal to add the frame
    frame_offsets = mx.arange(num_frames) * hop_length
    indices = frame_offsets[:, None] + mx.arange(n_fft)
    indices_flat = indices.flatten()

    updates_reconstructed = (frames_time * w).flatten()
    # Use window squared for COLA normalization (matches PyTorch's istft) or just window
    window_norm = (w * w) if normalized else w
    updates_window = mx.tile(window_norm, (num_frames,)).flatten()

    # overlap-add the inverse transformed frame, scaled by the window
    reconstructed = reconstructed.at[indices_flat].add(updates_reconstructed)
    window_sum = window_sum.at[indices_flat].add(updates_window)

    # normalize by the sum of (squared) window values
    # Avoid dividing by zero even on discarded samples: it produces NaN gradients.
    denominator = mx.where(window_sum > 1e-10, window_sum, 1.0)
    reconstructed = reconstructed / denominator

    start = n_fft // 2 if center else 0
    end = start + length if length is not None else t - start
    reconstructed = reconstructed[start:end]
    if length is not None and reconstructed.shape[0] < length:
        reconstructed = mx.pad(reconstructed, [(0, length - reconstructed.shape[0])])

    return reconstructed
