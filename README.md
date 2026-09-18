<div align="center">

<img src="demos/static/venus-logo-white.gif" width="120" alt="Realtime-Venus" />

# Realtime-Venus

**A full-duplex interaction system with asynchronous delegation**

Venus Team · Ant Group · Tsinghua University

**English** · [简体中文](README_ZH.md)

<a href="https://arxiv.org/abs/2609.13814"><img src="https://img.shields.io/badge/Paper-Technical_Report-B6A3EA?style=flat-square" alt="Technical report" /></a>
<a href="https://realtime-venus.github.io/"><img src="https://img.shields.io/badge/Project-Website-AEEBD6?style=flat-square" alt="Project website" /></a>
<a href="https://huggingface.co/inclusionAI/Realtime-Venus"><img src="https://img.shields.io/badge/🤗_Hugging_Face-Realtime--Venus-FFD21E?style=flat-square" alt="Hugging Face models" /></a>
<a href="https://www.modelscope.cn/models/inclusionAI/Realtime-Venus"><img src="https://img.shields.io/badge/ModelScope-Models-624AFF?style=flat-square" alt="ModelScope" /></a>

[Overview](#overview) · [Quick start](#quick-start) · [Results](#results) · [Code map](#code-map) · [Citation](#citation)

</div>

## Overview

**See, listen, and respond in real time—with background tasks running alongside the conversation.** Realtime-Venus combines full-duplex conversational models with an asynchronous execution framework. You can ask the assistant to work on a task and continue talking while it runs. The result returns to the same conversation for spoken delivery.

The project brings together three components:

| Component | Role |
| --- | --- |
| **Realtime-Venus-Omni · 9B** | A conversational model for streaming audio and video, proactive interaction, and native speech generation. |
| **Realtime-Venus-Audio · 9B** | A separately trained model for spoken interaction, audio understanding, and native speech generation. |
| **Realtime-Venus-Harness** | A shared runtime that captures delegated requests, executes background work, and returns results to the originating conversation. |

### What Realtime-Venus enables

- **Continuous audiovisual interaction.** Omni observes streaming camera and microphone input and can initiate a response when the evolving scene calls for it.
- **Full-duplex conversation.** The models process incoming speech while speaking, learning to distinguish acknowledgments and background speech from interruptions that call for a revised response.
- **Asynchronous delegation.** A model can hand a natural-language task to Harness for reasoning or tool execution while live interaction continues.
- **Results in the same conversation.** Harness prepares a reply; the conversational model handles its timing and native speech output. Work tracking separates task completion from spoken delivery.

The [paper](https://arxiv.org/html/2609.13814v1) describes the model family, dual-loop runtime, training data, and evaluation. **This source release includes the Omni model integration, the reusable Harness package, and a browser demo using a Codex task backend.** The demo's microphone-only mode also uses Omni.

## Quick start

### 1. Install dependencies

Run the commands from the repository root. For standalone inference, use Python 3.10 with CUDA and FFmpeg, and install the dependencies for your model:

```bash
# Realtime-Venus-Omni
python -m pip install -r /path/to/Realtime-Venus-Omni/requirements.txt

# Realtime-Venus-Audio
python -m pip install -r requirements.txt
```

For the browser demo, run the installer on Linux. It creates an isolated Python 3.11/3.12 environment and installs the model, web service, and Harness dependencies:

```bash
bash install.sh
```

Then choose standalone inference or the online experience below.

### 2. Offline inference · Frontend Usage

Download the model checkpoint from the links above and replace the example paths with your local directories.

#### Realtime-Venus-Omni

```bash
export REALTIME_VENUS_MODEL_PATH=/path/to/Realtime-Venus-Omni

python frontend/Realtime-Venus-Omni/offline_chat.py
# With long-video Memory
python frontend/Realtime-Venus-Omni/offline_memory_chat.py
```

These examples read videos from the checkpoint's `assets/` directory and output text and speech. To run full-duplex inference on recorded inputs instead:

```bash
python frontend/Realtime-Venus-Omni/duplex_chat.py
python frontend/Realtime-Venus-Omni/duplex_speech_in_chat.py
python frontend/Realtime-Venus-Omni/duplex_memory_chat.py
```

Duplex examples save subtitled videos. See the [Omni guide](frontend/Realtime-Venus-Omni/README.md) for inputs and output paths.

#### Realtime-Venus-Audio

```bash
python frontend/Realtime-Venus-Audio/audio_offline_chat.py \
  --model-path /path/to/Realtime-Venus-Audio \
  --audio frontend/Realtime-Venus-Audio/case/case_offline.wav
```

Offline inference returns text. To run full-duplex inference on recorded audio and save a 24 kHz WAV:

```bash
python frontend/Realtime-Venus-Audio/audio_duplex_chat.py \
  --model-path /path/to/Realtime-Venus-Audio \
  --audio frontend/Realtime-Venus-Audio/case/case_duplex.wav \
  --output output/duplex_response.wav
```

Both scripts accept `--system-prompt` and `--prompt`; see the [Audio guide](frontend/Realtime-Venus-Audio/README.md) for decoding options.

### 3. Online Duplex experience

The online Duplex demo requires **at least one NVIDIA A100 GPU**. Place the complete Omni checkpoint in `model_weight/`, then start the demo:

```bash
bash start.sh
```

For an existing checkpoint elsewhere:

```bash
bash start.sh --model-path /path/to/Realtime-Venus-Omni
```

Complete Codex login if prompted. The launcher starts the model API on **8031** and the browser service on **8032**.

If running on a remote server, keep this tunnel open on your local computer, replacing `user@server` with your SSH login:

```bash
ssh -N -L 8032:127.0.0.1:8032 user@server
```

Open [http://localhost:8032](http://localhost:8032), select **voice**, **camera + microphone**, or **video upload**, and start a conversation. Checkpoint layout, configuration, and service management are covered in the [Demo guide](demos/README.md).

## Results

<p align="center"><img src="assets/paper-understanding.svg" width="100%" alt="Paper Figure 1: radar charts comparing video understanding for Omni and audio understanding for Audio" /><br /><sub>Figure 1. Video and audio understanding results from the <a href="https://arxiv.org/html/2609.13814v1#S0.F1">paper</a>.</sub></p>

<p align="center"><img src="assets/paper-duplex.svg" width="100%" alt="Paper Figure 2: full-duplex benchmark comparisons for interruption handling and continuation under different types of overlapping speech" /><br /><sub>Figure 2. Full-duplex interaction results from the <a href="https://arxiv.org/html/2609.13814v1#S0.F2">paper</a>.</sub></p>

## Code map

```text
Realtime-Venus/
├── harness/                # Context, routing, agents, work state, and delivery
│   ├── README.md
│   └── requirements.txt    # Harness media dependencies
├── frontend/
│   ├── Realtime-Venus-Omni/ # Audiovisual inference examples
│   └── Realtime-Venus-Audio/ # Audio inference examples and input samples
├── demos/
│   ├── model/              # Checkpoint adapter and model HTTP API
│   ├── server/             # Web sessions, media, settings, and artifacts
│   ├── static/             # Browser UI, capture, playback, and logos
│   ├── launcher/           # Configuration and process supervision
│   ├── settings.py         # Saved task and model preferences
│   ├── install.py          # Isolated environment installation
│   └── requirements.txt    # Model and application dependencies
├── assets/                 # Paper figures, report, and Demo screenshot
├── pyproject.toml          # Standalone Harness package
├── requirements.txt        # Shared dependency entry for inference examples
├── config.example.json     # Server configuration template
└── install.sh / start.sh    # Install, start, inspect, and stop the Demo
```

## Citation

```bibtex
@article{zhao2026realtime,
  title={{Realtime-Venus}: A full-duplex interaction system with asynchronous delegation},
  author={{Venus Team,Ant Group;Tsinghua University}},
  journal={arXiv preprint arXiv:2609.13814},
  year={2026}
}
```

## License

The source code in this repository is licensed under the [Apache License 2.0](LICENSE), except for components with separate license notices. Third-party fonts and paper figures retain their respective licenses; see the license files in [`demos/static/fonts/`](demos/static/fonts/) and [`assets/README.md`](assets/README.md).
