"""One-command launch, health checks and shutdown for Realtime-Venus."""

from __future__ import annotations

import argparse
import fcntl
import getpass
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from .config import (
    LaunchConfig,
    checked_file,
    checkpoint_directory,
    ensure_ports_available,
)
from .supervisor import StackSupervisor, read_state


def setup_backend(config: LaunchConfig, allow_login: bool) -> None:
    from demos.settings import save_setup
    from demos.server.configuration import WebConfiguration

    configuration = WebConfiguration(config.settings)
    setup = configuration.load()
    if not config.settings.exists():
        binary = os.getenv("GENERAL_CODEX_BINARY") or shutil.which("codex")
        if not binary:
            candidate = config.runtime / "bin/codex"
            binary = str(candidate) if candidate.is_file() else None
        if not binary:
            raise RuntimeError("Codex executable is missing. Run bash install.sh.")
        setup.data["codex"]["command"] = [binary, "app-server"]
        setup.data["workspace"] = str(config.runtime / "workspace")
        # Reconstruct derived settings after filling startup defaults.
        from demos.settings import UserSetup

        setup = UserSetup(setup.data, config.settings)
    check = setup.check(web=True)
    if not check["ok"]:
        raise RuntimeError("; ".join(check["problems"]))
    binary = setup.general.command[0]
    status = subprocess.run(
        [binary, "login", "status"], capture_output=True, timeout=30
    )
    if status.returncode:
        if not allow_login or not sys.stdin.isatty():
            raise RuntimeError(
                f"Codex login required. Run {binary} login --device-auth, then retry."
            )
        print("Complete Codex device login in your local browser.", flush=True)
        subprocess.run([binary, "login", "--device-auth"], check=True)
    setup.workspace.mkdir(parents=True, exist_ok=True)
    if not config.settings.exists():
        save_setup(setup.data, config.settings)


def show_access(config: LaunchConfig) -> None:
    print(
        f"\nRealtime-Venus-Omni API: http://127.0.0.1:{config.model_port}", flush=True
    )
    print(f"Realtime-Venus-Harness: http://localhost:{config.web_port}", flush=True)
    ssh = os.getenv("SSH_CONNECTION", "").split()
    server = ssh[2] if len(ssh) == 4 else "<server>"
    print("From your local computer, keep this SSH tunnel open:", flush=True)
    print(
        f"  ssh -N -L {config.web_port}:127.0.0.1:{config.web_port} {getpass.getuser()}@{server}",
        flush=True,
    )
    print("Choose video upload or microphone/camera in the browser.", flush=True)
    print(f"Logs: {config.runtime}/logs; stop: bash start.sh --stop", flush=True)


def _run(argv=None):
    root = Path(os.getenv("VENUS_ROOT", Path.cwd())).expanduser().resolve()
    config_file = root / "config.json"
    options = json.loads(config_file.read_text()) if config_file.exists() else {}
    allowed = {
        "model_path",
        "reference_audio",
        "model_port",
        "web_port",
        "web_host",
        "memory_minutes",
    }
    if not isinstance(options, dict) or options.keys() - allowed:
        raise ValueError("Unknown deployment settings in config.json")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-path",
        default=os.getenv(
            "MODEL_PATH", options.get("model_path", str(root / "model_weight"))
        ),
    )
    parser.add_argument(
        "--ref-audio", default=os.getenv("REF_AUDIO") or options.get("reference_audio")
    )
    parser.add_argument(
        "--model-port",
        type=int,
        default=int(os.getenv("VENUS_MODEL_PORT", options.get("model_port", 8031))),
    )
    parser.add_argument(
        "--web-port",
        type=int,
        default=int(os.getenv("VENUS_WEB_PORT", options.get("web_port", 8032))),
    )
    parser.add_argument(
        "--host",
        default=os.getenv("VENUS_WEB_HOST", options.get("web_host", "127.0.0.1")),
    )
    parser.add_argument(
        "--memory-minutes",
        type=int,
        default=int(
            os.getenv("VENUS_MEMORY_MINUTES", options.get("memory_minutes", 40))
        ),
    )
    parser.add_argument("--startup-timeout", type=float, default=600)
    parser.add_argument(
        "--no-login",
        action="store_true",
        help="Fail immediately if Codex is not authenticated",
    )
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument(
        "--detach",
        action="store_true",
        help="Wait until ready, then leave both services running",
    )
    actions.add_argument(
        "--stop", action="store_true", help="Stop only the stack owned by this checkout"
    )
    actions.add_argument(
        "--status", action="store_true", help="Show process ownership and startup state"
    )
    actions.add_argument(
        "--check",
        action="store_true",
        help="Validate assets, ports, CUDA and backend without starting services",
    )
    args = parser.parse_args(argv)
    runtime = root / "runtime"
    runtime.mkdir(exist_ok=True)
    state = read_state(runtime / "stack.json")
    if args.status:
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return
    if args.stop:
        if state["alive"]:
            os.kill(state["pid"], signal.SIGTERM)
            deadline = time.monotonic() + 50
            while (
                read_state(runtime / "stack.json")["alive"]
                and time.monotonic() < deadline
            ):
                time.sleep(0.2)
            if read_state(runtime / "stack.json")["alive"]:
                raise RuntimeError(
                    "Shutdown is still in progress; inspect runtime/logs before retrying."
                )
        print("Realtime-Venus stack stopped.")
        return
    if state["alive"]:
        parser.error(
            "This checkout already owns a running stack. Use --status or --stop."
        )
    model = checkpoint_directory(root / Path(args.model_path))
    ref = (
        checked_file(root / Path(args.ref_audio))
        if args.ref_audio
        else checked_file(model / "assets/HT_ref_audio.wav")
    )
    config = LaunchConfig(
        root,
        model,
        ref,
        os.getenv("VENUS_MODEL_PYTHON", sys.executable),
        sys.executable,
        args.host,
        args.model_port,
        args.web_port,
        args.memory_minutes,
        args.startup_timeout,
    )
    if config.memory_minutes <= 0 or config.startup_timeout <= 0:
        parser.error("Memory duration and startup timeout must be positive")
    ensure_ports_available("127.0.0.1", (config.model_port, config.web_port))
    if config.host != "127.0.0.1":
        ensure_ports_available(config.host, (config.web_port,))
    subprocess.run(
        [
            config.model_python,
            "-c",
            'import torch; assert torch.cuda.is_available(), "No CUDA GPU available"; print("GPU:", torch.cuda.get_device_name(0))',
        ],
        check=True,
        timeout=60,
    )
    setup_backend(config, allow_login=not args.no_login)
    if args.check:
        print("Checkpoint, speech assets, ports, CUDA and backend: OK")
        return
    if args.detach:
        child_args = [
            a for a in (sys.argv[1:] if argv is None else argv) if a != "--detach"
        ]
        (runtime / "logs").mkdir(exist_ok=True)
        with (runtime / "logs/stack.log").open("ab", buffering=0) as log:
            child = subprocess.Popen(
                [sys.executable, "-m", "demos", *child_args, "--no-login"],
                cwd=root,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        deadline = time.monotonic() + config.startup_timeout * 2 + 90
        try:
            while child.poll() is None and time.monotonic() < deadline:
                current = read_state(runtime / "stack.json")
                if current.get("pid") == child.pid and current.get("status") == "ready":
                    show_access(config)
                    return
                time.sleep(0.25)
            raise RuntimeError("Stack startup failed; see runtime/logs/stack.log")
        except BaseException:
            child.terminate()
            child.wait(timeout=50)
            raise
    with (runtime / "stack.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("Another launcher owns this checkout")
        model_command = [
            config.model_python,
            "-m",
            "demos.model.server",
            "--model-path",
            str(model),
            "--ref-audio",
            str(ref),
            "--memory-minutes",
            str(config.memory_minutes),
            "--host",
            "127.0.0.1",
            "--port",
            str(config.model_port),
        ]
        web_command = [
            config.web_python,
            "-m",
            "demos.server.cli",
            "--model-server",
            f"http://127.0.0.1:{config.model_port}",
            "--tokenizer-path",
            str(model),
            "--config",
            str(config.settings),
            "--host",
            config.host,
            "--port",
            str(config.web_port),
        ]
        print(
            "Loading Realtime-Venus-Omni; the web application starts after the model is ready.",
            flush=True,
        )
        StackSupervisor(config, model_command, web_command).run(
            lambda: show_access(config)
        )


def main(argv=None):
    try:
        return _run(argv)
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"Startup failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
