"""Validated local settings shared by the launcher and browser."""

import json
import os
import shutil
import tempfile
from dataclasses import asdict, fields, is_dataclass, replace
from pathlib import Path

from demos.model.settings import DuplexSettings
from harness.agents.config import GeneralAgentConfig
from harness.config import ModelCallConfig, RoutingConfig
from harness.core.config import HarnessConfig
from harness.jobs.feedback import FeedbackConfig


def template():
    harness = HarnessConfig()
    return {
        "version": 1,
        "language": "zh",
        "workspace": "./workspace",
        "codex": {
            key: value
            for key, value in asdict(GeneralAgentConfig(effort="low")).items()
            if key not in {"workspace", "approval_policy", "sandbox", "queue_timeout_s"}
        },
        "routing": asdict(RoutingConfig()),
        "responses": asdict(ModelCallConfig()),
        "duplex": asdict(DuplexSettings()),
        "feedback": {**asdict(FeedbackConfig()), "progress_timeout_s": 180},
        "harness": {
            name: asdict(getattr(harness, name))
            for name in (
                "buffer",
                "workspace",
                "delegate",
                "runtime",
                "result_management",
            )
        },
    }


def config_path(path=None):
    return (
        Path(path or os.getenv("HARNESS_CONFIG", "runtime/harness.json"))
        .expanduser()
        .resolve()
    )


def merge(default, supplied):
    if isinstance(default, dict) and isinstance(supplied, dict):
        return {
            **default,
            **{key: merge(default.get(key), value) for key, value in supplied.items()},
        }
    return supplied


def settings(instance, values):
    if not isinstance(values, dict) or values.keys() - {
        field.name for field in fields(instance)
    }:
        raise ValueError("Unknown or invalid settings")
    updates = {
        key: settings(getattr(instance, key), value)
        if is_dataclass(getattr(instance, key))
        else value
        for key, value in values.items()
    }
    return replace(instance, **updates)


class UserSetup:
    def __init__(self, data, path):
        if not isinstance(data, dict) or data.keys() - template().keys():
            raise ValueError("Unknown configuration sections")
        self.data = merge(template(), data)
        self.path = Path(path).resolve()
        self.language = self.data["language"]
        if self.data["version"] != 1 or self.language not in {"zh", "en"}:
            raise ValueError("Invalid configuration version or language")
        self.workspace = (
            self.path.parent / Path(self.data["workspace"]).expanduser()
        ).resolve()
        if self.workspace == Path(self.workspace.anchor):
            raise ValueError("Choose a task workspace, not the filesystem root")
        codex = dict(self.data["codex"])
        if {
            "workspace",
            "approval_policy",
            "sandbox",
            "queue_timeout_s",
        } & codex.keys():
            raise ValueError("Workspace permissions are managed by the application")
        if not isinstance(codex.get("command"), (list, tuple)):
            raise ValueError("Codex command must be an argument list")
        codex["command"] = tuple(codex["command"])
        self.general = settings(
            GeneralAgentConfig(workspace=str(self.workspace)), codex
        )
        self.routing = settings(RoutingConfig(), self.data["routing"])
        self.responses = settings(ModelCallConfig(), self.data["responses"])
        self.duplex = settings(DuplexSettings(), self.data["duplex"])
        self.feedback = settings(FeedbackConfig(), self.data["feedback"])
        if self.feedback.journal_path and self.feedback.journal_path != ":memory:":
            self.feedback = replace(
                self.feedback,
                journal_path=str(
                    (
                        self.path.parent / Path(self.feedback.journal_path).expanduser()
                    ).resolve()
                ),
            )
        base = HarnessConfig(language=self.language)
        values = self.data["harness"]
        allowed = {"buffer", "workspace", "delegate", "runtime", "result_management"}
        if not isinstance(values, dict) or values.keys() - allowed:
            raise ValueError("Unknown Harness configuration")
        self.harness = replace(
            base,
            **{
                key: settings(getattr(base, key), value)
                for key, value in values.items()
            },
        )
        document_root = Path(self.harness.workspace.root or self.workspace).expanduser()
        self.harness = replace(
            self.harness,
            workspace=replace(
                self.harness.workspace,
                root=str((self.path.parent / document_root).resolve()),
            ),
        )

    def check(self, *, web=True):
        problems = []
        if not shutil.which(self.general.command[0]):
            problems.append("Codex executable not found / 找不到 Codex 程序")
        return {"ok": not problems, "problems": problems}


def load_setup(path=None):
    target = config_path(path)
    return (
        UserSetup(json.loads(target.read_text()), target)
        if target.exists()
        else UserSetup(template(), target)
    )


def save_setup(data, path):
    target = config_path(path)
    setup = UserSetup(data, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix="harness-settings-", dir=target.parent
    )
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(setup.data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return setup
