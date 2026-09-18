# Realtime-Venus-Harness

[English](README.md) · **简体中文** · [项目总览](../README_ZH.md) · [启动 Demo](../demos/README_ZH.md) · [论文](https://arxiv.org/html/2609.13814v1#S5)

Harness 接收 `<delegate>...</delegate>` 请求，异步执行任务并将结果送回原会话，管理任务上下文、执行、进度、取消、续接与交付。

## 架构

<p align="center"><img src="../assets/paper-harness.svg" width="100%" alt="论文图 7：Harness 的 Capture、Dispatch、Return 三阶段，贯穿其中的任务状态与播放确认" /><br /><sub>论文<a href="https://arxiv.org/html/2609.13814v1#S5.F7">图 7</a>：任务跟踪贯穿 Capture、Dispatch 和 Return。</sub></p>

### 1. Capture：捕获请求与稳定的上下文

协议入口跨 chunk 组装 delegate 请求，在开始标记处固定上下文边界，请求完整后连同来源会话一起注册。结构化任务可直接调用 `DelegateHarness.submit_delegate` 或 `submit_request`。

### 2. Dispatch：选择能力并执行

| 路径 | 作用 | 实现入口 |
| --- | --- | --- |
| **Multimodal / 直接问答** | 使用请求对应的音频或视觉证据完成理解与问答。 | [`llm/delegate.py`](llm/delegate.py) |
| **General** | 执行需要工具或多个步骤的任务，保留进度与生成产物。 | [`agents/`](agents/)、[`jobs/`](jobs/) |
| **Skill** | 调用已注册的领域能力，按声明的参数契约执行。 | [`skills.py`](skills.py) |

**General 模式**直接将任务交给 General 执行器；**Auto 模式**由 planner 选择能力，或处理进度查询与任务续接。独立使用 `PlannerClient` 时默认为 Auto，网页 Demo 默认为 General。可用工具与技能取决于执行器配置和能力注册。

### 3. Return：为当前对话准备回复

Harness 整理口头回复，检查交付条件并移除保留协议文本。Serving host 在允许的输入边界将 `<backend>...</backend>` 插入原会话，由 Omni 生成语音。

## 模型与后端接入

| 边界 | 当前提供的集成 | 扩展方式 |
| --- | --- | --- |
| 对话模型 | Demo 通过 `RemoteOmniServingPort` 和 HTTP 模型服务连接 Omni。 | 实现 `VenusOmniServingPort`，或通过 `DelegateHarness` 提交结构化任务。 |
| 任务执行 | `CodexAgentProvider` 及其 app-server 连接。 | 为其他执行器实现 `GeneralAgentPort`。 |
| 路由与回复整理 | `CodexPlannerBackend` 和 `CodexDirectAndPolish`。 | 实现 `PlannerBackend` 或 `DelegateBackend` 契约。 |
| 客户端播放 | Demo 中的浏览器播放器。 | 实现 `PlaybackPort`，仅确认已完成的播放。 |
| 领域能力 | `AgentSkill` 和 `SkillRegistry`。 | 注册能力描述、参数校验与执行器。 |

## 开始使用

### 在自己的应用中使用

使用 Python **3.11 或 3.12**，在仓库根目录安装：

```bash
python -m pip install -e .
```

Python 导入名为 `harness`。完整系统的启动方法见 [Demo 指南](../demos/README_ZH.md)。

传入实现了 [`DelegateBackend`](core/backend.py) 的后端，提供 `plan`、`execute`、`oralize` 和 `aclose`：

```python
from harness.core.backend import DelegateBackend
from harness.core.harness import DelegateHarness

async def request_background_work(backend: DelegateBackend):
    harness = DelegateHarness(backend=backend)
    try:
        await harness.open_session("demo-session")
        work_id = await harness.submit_delegate(
            "demo-session", "生成一个包含 1–100 及其平方的 CSV 文件。"
        )
        while True:
            result = await harness.next_delegate_result(
                "demo-session", timeout_s=180
            )
            if result.work_id == work_id and result.status != "pending":
                return work_id, result
    finally:
        await harness.aclose()
```

Codex 后端的组装见 [`demos/server/resources.py`](../demos/server/resources.py)。

### 接入流式模型

`VenusOmniAgentHarness` 组装任务运行时，`VenusOmniServingHost` 连接 tokenizer、模型 serving port 与播放器：

1. 打开 host 会话并校验模型协议 token ID。
2. 通过 `append_audio` 和 `append_video_frame` 输入带时间戳的媒体。
3. 用单一 `next_output` 循环按顺序消费模型原始输出，将允许播放的语音交给播放器。
4. 在符合条件的边界调用 `begin_backend_turn`，注入排队中的私有反馈。
5. 仅对实际播放完成的 chunk 调用 `acknowledge_playback`。
6. 关闭 host 会话；运行时拥有者退出时调用 `agent.aclose()`。

可运行的完整链路见 [`demos/server/session.py`](../demos/server/session.py)。`DelegateParser` 提供纯文本解析。

## 任务生命周期

```text
QUEUED → RUNNING → COMPLETED → DELIVERING → DELIVERED
             └→ FAILED
取消路径：CANCELLING → CANCELLED
```

| 状态 | 含义 |
| --- | --- |
| `QUEUED` | 请求已接受，等待执行。 |
| `RUNNING` | 正在路由、执行任务或准备回复。 |
| `COMPLETED` | 终态结果和准备好的回复已可用。 |
| `DELIVERING` | 反馈已为送回原会话而保留。 |
| `DELIVERED` | 交付完成；带语音的回复需要生成结束，以及关联语音的播放确认。 |

反馈回传前检查时效与会话归属。状态定义与交付逻辑见 [`jobs/models.py`](jobs/models.py) 和 [`bridge/runtime.py`](bridge/runtime.py)。
