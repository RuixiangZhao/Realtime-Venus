"""Compose the model connection and asynchronous Harness for a browser session."""

import asyncio
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Any

from demos.model.client import RemoteOmniServingPort
from demos.settings import load_setup
from harness.agents import CodexAgentProvider
from harness.bridge.config import venus_harness_config
from harness.bridge.runtime import VenusOmniAgentHarness
from harness.config import Settings
from harness.llm.backends import CodexPlannerBackend
from harness.llm.delegate import CodexDirectAndPolish
from harness.llm.planner import PlannerClient


@dataclass
class WebResources:
    agent: VenusOmniAgentHarness
    serving: RemoteOmniServingPort
    tokenizer: Any
    model: str = "Realtime-Venus-Omni"

    async def close(self):
        try:
            await self.agent.aclose()
        finally:
            await self.serving.aclose()


@lru_cache(maxsize=2)
def load_tokenizer(path):
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(
        path, trust_remote_code=True, local_files_only=True
    )


async def real_resources(*, mode, settings_path, server_url, tokenizer_path):
    if mode not in {"omni", "audio"}:
        raise ValueError("Unknown input mode")
    tokenizer = await asyncio.to_thread(
        load_tokenizer, str(Path(tokenizer_path).resolve())
    )
    setup = load_setup(settings_path)
    general = setup.general
    config = venus_harness_config(setup.harness)
    config = replace(
        config,
        delegate=replace(
            config.delegate,
            request_timeout_s=180,
            oralization_timeout_s=180,
            result_ttl_ms=600_000,
        ),
    )
    settings = Settings(
        codex_path=general.command[0],
        codex_model=setup.responses.model or general.model or "",
        codex_workspace=general.workspace,
        codex_timeout_seconds=setup.responses.timeout_s,
        codex_effort=setup.responses.effort,
    )
    transport = CodexPlannerBackend(settings)
    router = CodexPlannerBackend(
        replace(
            settings,
            codex_model=setup.routing.model or general.model or "",
            codex_timeout_seconds=setup.routing.timeout_s,
            codex_effort=setup.routing.effort,
        )
    )
    agent = VenusOmniAgentHarness(
        CodexDirectAndPolish(transport),
        planner=PlannerClient(
            settings,
            backend=transport,
            router_backend=router,
            routing_mode=setup.routing.mode,
        ),
        general_agent=CodexAgentProvider(general),
        general_config=general,
        feedback_config=setup.feedback,
        config=config,
    )
    return WebResources(
        agent,
        RemoteOmniServingPort(
            server_url, timeout_s=180, length_penalty=setup.duplex.length_penalty
        ),
        tokenizer,
    )
