# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: OpenMDW-1.1
"""NVIDIA NemotronLabs RE-USE speech enhancement on MLX (vendored, minimal).

The network code (config.py, mamba.py, network.py, most of model.py) is the MLX port of
NVIDIA-NemotronLabs-RE-USE from mlx-audio (https://github.com/Blaizzy/mlx-audio, MIT, commit
93cfb9ff82c1, `mlx_audio/sts/models/nemotron_reuse`), itself adapted from NVIDIA's code. It is
vendored so that Banditur's engine does not need mlx-audio's dependencies (scipy, transformers,
...). The model weights are NVIDIA's (OpenMDW-1.1) and are downloaded on first use, never
shipped: see README.md → Awdjo → Licences.
"""

from .model import Model, load_model

__all__ = ["Model", "load_model"]
