"""Assemble one private, model-facing message for each delegate result."""

from __future__ import annotations

from typing import Any, Dict

from .models import DelegateResult


def assemble_frontend_message(result: DelegateResult) -> Dict[str, Any]:
    """Return the only delegate payload the frontend model needs to read.

    The session runner guarantees ``spoken_text`` for completed, pending, and
    failed results. The defensive fallback keeps this delivery boundary useful
    for results constructed by older integrations as well.
    """

    text = result.spoken_text.strip() or "抱歉，刚才的问题暂时没能处理完成。"
    message = {
        "type": "delegate_result",
        "work_id": result.work_id,
        "text": text,
    }
    if result.feedback_id:
        label = {
            "progress": "进度反馈，任务仍在运行",
            "milestone": "阶段进度，任务仍在运行",
            "important": "重要进度，任务仍在运行",
            "correction": "进度纠正，任务仍在运行",
            "need_input": "需要用户处理，任务等待中",
            "error": "任务异常说明",
            "cancelled": "取消结果说明",
            "final": "任务最终结果",
        }.get(result.metadata.get("kind"), "任务反馈")
        if result.metadata.get("language") == "en":
            label = {
                "progress": "Progress update; task still running",
                "milestone": "Milestone update; task still running",
                "important": "Important update; task still running",
                "correction": "Progress correction; task still running",
                "need_input": "Task waiting for user input",
                "error": "Task error",
                "cancelled": "Task cancellation",
                "final": "Task result",
            }.get(result.metadata.get("kind"), "Task update")
        if result.status == "pending":
            separator = ": " if result.metadata.get("language") == "en" else "："
            message["text"] = f"{label}{separator}{text}"
        message.update(
            feedback_id=result.feedback_id, kind=result.metadata.get("kind", "final")
        )
    return message
