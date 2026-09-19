<div align="center">

<img src="demos/static/venus-logo-white.gif" width="120" alt="Realtime-Venus" />

# Realtime-Venus

**支持异步委托的全双工交互系统**

<p align="center">Venus Team(Ant Group)和Tsinghua University</p>

<p align="center"><a href="README.md">English</a> | <strong>简体中文</strong></p>

<p align="center">
<a href="https://realtime-venus.github.io/"><img src="https://img.shields.io/badge/Project_Page-4c9aff.svg?logo=googlechrome&logoColor=white" alt="Project Page"></a>
<a href="https://huggingface.co/inclusionAI/Realtime-Venus"><img src="https://img.shields.io/badge/Hugging_Face-Realtime--Venus-FFD21E.svg?logo=huggingface&logoColor=000" alt="Realtime-Venus on Hugging Face"></a>
<a href="https://www.modelscope.cn/models/inclusionAI/Realtime-Venus"><img src="https://img.shields.io/badge/ModelScope-Realtime--Venus-624AFF.svg?logo=modelscope&logoColor=white" alt="Realtime-Venus on ModelScope"></a>
<a href="https://arxiv.org/abs/2609.13814"><img src="https://img.shields.io/badge/arXiv-2609.13814-b31b1b.svg?logo=arxiv&logoColor=white" alt="arXiv"></a>
<a href="https://github.com/inclusionAI/Realtime-Venus"><img src="https://img.shields.io/badge/GitHub-Realtime--Venus-181717.svg?logo=github&logoColor=white" alt="GitHub"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-0b7285.svg?logo=apache&logoColor=white" alt="Apache License 2.0"></a>
</p>

[项目介绍](#项目介绍) · [快速开始](#快速开始) · [评测结果](#评测结果) · [代码结构](#代码结构) · [引用](#引用)

</div>

## 项目介绍

**实时看、听、说，让后台任务与对话同时进行。** Realtime-Venus 将全双工对话模型与异步执行框架结合起来：你可以让助手处理任务，同时继续和它交流；任务完成后，结果回到同一段对话中，由模型用语音告诉你。

整个项目由三个部分组成：

| 组件 | 职责 |
| --- | --- |
| **Realtime-Venus-Omni · 9B** | 面向流式音视频的对话模型，支持持续感知、主动交互与原生语音生成。 |
| **Realtime-Venus-Audio · 9B** | 单独训练的语音对话模型，支持音频理解、全双工交互与原生语音生成。 |
| **Realtime-Venus-Harness** | 两类模型共用的异步执行框架，负责接收委托、推进后台任务，并将结果送回原会话。 |

### 核心能力

- **持续的视听交互。** Omni 持续接收摄像头和麦克风输入，能够根据场景中的新变化主动发起回应。
- **全双工对话。** 模型在说话时继续处理用户输入，学习区分附和、背景人声与需要调整回复的打断。
- **异步任务委托。** 遇到需要进一步推理或调用工具的请求，模型将自然语言任务交给 Harness 执行，实时对话继续进行。
- **在原对话中交付结果。** Harness 准备回复内容，前端模型决定发言时机并生成语音；任务执行完成与结果实际播放分别跟踪。

[论文](https://arxiv.org/html/2609.13814v1)介绍了模型家族、双 loop 运行机制、训练数据与评测。**本次源码发布提供 Omni 模型接入、可复用的 Harness 包，以及使用 Codex 任务后端的网页 Demo。** 网页的纯麦克风模式同样使用 Omni。

## 快速开始

### 1. 安装依赖

以下命令均在仓库根目录执行。独立推理使用 Python 3.10、CUDA 和 FFmpeg，按需安装对应模型的依赖：

```bash
# Realtime-Venus-Omni
python -m pip install -r /path/to/Realtime-Venus-Omni/requirements.txt

# Realtime-Venus-Audio
python -m pip install -r requirements.txt
```

网页体验在 Linux 上运行安装脚本，自动创建独立的 Python 3.11/3.12 环境，并安装模型、网页服务和 Harness 的依赖：

```bash
bash install.sh
```

安装后，按需选择下面的离线推理或在线体验。

### 2. 离线推理 · Frontend Usage

从上方模型入口下载权重，将示例路径替换为本地目录。

#### Realtime-Venus-Omni

```bash
export REALTIME_VENUS_MODEL_PATH=/path/to/Realtime-Venus-Omni

python frontend/Realtime-Venus-Omni/offline_chat.py
# 启用长视频 Memory
python frontend/Realtime-Venus-Omni/offline_memory_chat.py
```

示例读取权重目录 `assets/` 中的视频，输出文本与语音。也可以使用录制好的输入运行全双工推理：

```bash
python frontend/Realtime-Venus-Omni/duplex_chat.py
python frontend/Realtime-Venus-Omni/duplex_speech_in_chat.py
python frontend/Realtime-Venus-Omni/duplex_memory_chat.py
```

双工示例保存带字幕的视频，输入素材和输出路径见 [Omni 指南](frontend/Realtime-Venus-Omni/README.md)。

#### Realtime-Venus-Audio

```bash
python frontend/Realtime-Venus-Audio/audio_offline_chat.py \
  --model-path /path/to/Realtime-Venus-Audio \
  --audio frontend/Realtime-Venus-Audio/case/case_offline.wav
```

离线推理返回文本。使用录制好的音频运行全双工推理并保存 24 kHz WAV：

```bash
python frontend/Realtime-Venus-Audio/audio_duplex_chat.py \
  --model-path /path/to/Realtime-Venus-Audio \
  --audio frontend/Realtime-Venus-Audio/case/case_duplex.wav \
  --output output/duplex_response.wav
```

两个脚本均支持 `--system-prompt` 与 `--prompt`，解码参数见 [Audio 指南](frontend/Realtime-Venus-Audio/README.md)。

### 3. 在线 Duplex 体验

在线 Duplex 体验**至少需要一张 NVIDIA A100**。将完整的 Omni 权重放入 `model_weight/`，然后启动：

```bash
bash start.sh
```

已有权重位于其他目录时：

```bash
bash start.sh --model-path /path/to/Realtime-Venus-Omni
```

如出现 Codex 登录提示，按提示完成登录。启动器会启动 **8031** 端口的模型 API 和 **8032** 端口的网页服务。

在远程服务器上运行时，在本地电脑保持以下 SSH 隧道，将 `user@server` 替换为你的 SSH 登录地址：

```bash
ssh -N -L 8032:127.0.0.1:8032 user@server
```

打开 [http://localhost:8032](http://localhost:8032)，选择**语音、摄像头与麦克风、视频上传**中的一种模式，开始对话。权重目录、配置与服务管理见 [Demo 文档](demos/README_ZH.md)。

## 评测结果

<p align="center"><img src="assets/paper-understanding.svg" width="100%" alt="论文图 1：Omni 视频理解与 Audio 音频理解的基准对比雷达图" /><br /><sub>图 1：视频与音频理解能力对比，来自<a href="https://arxiv.org/html/2609.13814v1#S0.F1">论文</a>。</sub></p>

<p align="center"><img src="assets/paper-duplex.svg" width="100%" alt="论文图 2：用户打断响应以及不同重叠语音条件下的继续发言表现" /><br /><sub>图 2：全双工交互评测，来自<a href="https://arxiv.org/html/2609.13814v1#S0.F2">论文</a>。</sub></p>

## 代码结构

```text
Realtime-Venus/
├── harness/                # 上下文、路由、Agent、任务状态与交付
│   ├── README.md
│   └── requirements.txt    # Harness 媒体依赖
├── frontend/
│   ├── Realtime-Venus-Omni/ # 视听模型推理示例
│   └── Realtime-Venus-Audio/ # 音频模型推理示例与输入素材
├── demos/
│   ├── model/              # 权重适配与模型 HTTP API
│   ├── server/             # 网页会话、媒体、配置与产物接口
│   ├── static/             # 网页、采集、播放与 Logo
│   ├── launcher/           # 配置校验与进程管理
│   ├── settings.py         # 任务及模型偏好配置
│   ├── install.py          # 独立环境安装
│   └── requirements.txt    # 模型与应用依赖
├── assets/                 # 论文图片、报告与 Demo 截图
├── pyproject.toml          # Harness 独立打包配置
├── requirements.txt        # 推理示例共用的依赖入口
├── config.example.json     # 服务器配置模板
└── install.sh / start.sh    # Demo 安装、启动、状态查询与停止
```

## 引用

```bibtex
@misc{venusteam2026realtimevenus,
  title         = {Realtime-Venus: A full-duplex interaction system with asynchronous delegation},
  author        = {{Venus Team(Ant Group), Tsinghua University}},
  year          = {2026},
  eprint        = {2609.13814},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CV},
  url           = {https://arxiv.org/abs/2609.13814}
}
```

## 许可证

本仓库源代码采用 [Apache License 2.0](LICENSE)，单独标注许可证的组件除外。第三方字体和论文图片保留各自的许可条款，详见 [`demos/static/fonts/`](demos/static/fonts/) 中的许可证文件及 [`assets/README.md`](assets/README.md)。
