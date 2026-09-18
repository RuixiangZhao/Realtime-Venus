"""Real backend calls for delegated understanding and spoken responses."""

import json
import tempfile
import time
from pathlib import Path

from harness.core.models import BackendResponse
from harness.core.prompt import (
    build_oralization_prompt,
    oralization_system_instruction,
)


class CodexDirectAndPolish:
    """Image-aware requests and spoken summaries using the existing Codex login."""

    def __init__(self, backend):
        self.backend = backend

    async def execute(self, request, context):
        started = time.monotonic()
        frames = context.video.frames if context.video else ()
        if context.snapshot.audio_chunks and not frames:
            raise ValueError(
                "This backend accepts text and images; ask Venus to describe the audio in its request"
            )
        with tempfile.TemporaryDirectory(prefix="venus-direct-") as temp:
            root = Path(temp)
            output = root / "answer.json"
            command = [
                self.backend._executable,
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--color",
                "never",
                "--cd",
                str(root),
                "--output-last-message",
                str(output),
            ]
            command.extend(self.backend.model_options())
            for index, frame in enumerate(frames):
                path = root / f"frame-{index}.png"
                path.write_bytes(frame.data)
                command.extend(["--image", str(path)])
            command.append("-")
            await self.backend._run(
                command,
                "根据用户要求和附加图片直接回答，不运行命令、不读取其他文件、不调用工具。"
                '返回 JSON {"speech":"回答内容"}，不加 Markdown 包裹。'
                f"\n回答语言：{request.language}\n用户要求：{request.query}",
            )
            raw = json.loads(output.read_text())
            speech = raw["speech"]
            if not isinstance(speech, str) or not speech.strip():
                raise ValueError("Direct 模型返回了空文本")
        return BackendResponse(
            speech,
            "codex-live",
            "codex-configured",
            int((time.monotonic() - started) * 1000),
        )

    async def oralize(self, request, source):
        started = time.monotonic()
        raw = await self.backend.complete(
            oralization_system_instruction(request.language)
            + '\nReturn JSON {"speech":"spoken answer in the requested language"}; no Markdown.',
            {"input": build_oralization_prompt(request, source.text)},
        )
        speech = json.loads(raw)["speech"]
        if not isinstance(speech, str) or not speech.strip():
            raise ValueError("Polish 模型返回了空文本")
        return BackendResponse(
            speech,
            "codex-live-polish",
            "codex-configured",
            int((time.monotonic() - started) * 1000),
        )

    async def aclose(self):
        pass
