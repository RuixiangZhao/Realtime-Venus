import { t, getLanguage, setLanguage } from "./i18n.js";
import { Presence } from "./presence.js";
import { AudioPlayer, encode } from "./audio.js";
import { MediaCapture } from "./capture.js";
import { MicrophoneWaveform } from "./waveform.js";
import { TaskTray } from "./tasks.js";

const $ = (id) => document.getElementById(id);
const state = {
  mode: "audio",
  phase: "idle",
  connected: false,
  connecting: false,
  stopping: false,
  epoch: 0,
  socket: null,
  sessionId: null,
  token: null,
  startedAt: 0,
  configuration: null,
  file: null,
  fileUrl: null,
  upload: null,
  uploadState: "",
  muted: false,
  outputMuted: false,
  transcript: new Map(),
  lastBackpressure: 0,
  online: true,
};
const devices = { microphone: "", camera: "" };
try {
  Object.assign(
    devices,
    JSON.parse(localStorage.getItem("venus-devices") || "{}"),
  );
} catch {}
const presence = new Presence($("presence-canvas"));
const microphoneWaveform = new MicrophoneWaveform($("mic-visualizer"));
const tasks = new TaskTray({ send, download: downloadArtifact });
const player = new AudioPlayer({
  ack: send,
  onText: appendText,
  onActivity: (active) => {
    if (state.connected) setPhase(active ? "speaking" : "listening");
  },
  onError: () => {
    notify(t("browserAudio"), true);
    void stopSession().catch(() => {});
  },
});
const capture = new MediaCapture($("preview-video"), {
  onChunk: sendInput,
  onLevel: (level) => (presence.inputLevel = level),
  onEnded: () => {
    notify(t("deviceEnded"), true);
    void stopSession().catch(() => {});
  },
  onBackpressure: backpressure,
});
let toastTimer;
function notify(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 7000 : 4200,
  );
}
function humanError(error) {
  const key = {
    NotAllowedError: "permissionDenied",
    PermissionDeniedError: "permissionDenied",
    NotFoundError: "deviceMissing",
    NotReadableError: "deviceBusy",
    InsecureContextError: "insecure",
  }[error?.name];
  return key ? t(key) : error?.message || t("connectionFailed");
}
function setPhase(phase) {
  state.phase = phase;
  document.body.dataset.phase = phase;
  presence.phase = phase;
  render();
}
function send(message) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}
function backpressure() {
  if (Date.now() - state.lastBackpressure > 20000) {
    state.lastBackpressure = Date.now();
    notify(t("slowConnection"));
  }
}
function sendInput(pcm, jpeg) {
  if (!state.connected) return;
  if (state.socket.bufferedAmount > 256 * 1024) {
    backpressure();
    return;
  }
  if (jpeg) send({ type: "video_frame", format: "jpeg", data: encode(jpeg) });
  send({
    type: "audio",
    format: "pcm16",
    sample_rate: 16000,
    data: encode(pcm),
  });
}
function render() {
  const busy = state.connected || state.connecting || state.stopping;
  document.body.dataset.mode = state.mode;
  const micActive = Boolean(capture.stream) && state.mode !== "video" && !state.stopping;
  microphoneWaveform.setState(micActive, state.muted);
  document.body.classList.toggle("mic-open", micActive);
  for (const button of document.querySelectorAll(".mode-button")) {
    button.classList.toggle("selected", button.dataset.mode === state.mode);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mode === state.mode),
    );
    button.disabled = busy;
  }
  $("start-button").hidden = state.connected;
  $("start-button").disabled = state.connecting || state.stopping;
  $("start-label").textContent = t(
    state.stopping
      ? "ending"
      : state.connecting
        ? "connecting"
        : state.mode === "video"
          ? state.file
            ? "startVideo"
            : "chooseVideo"
          : "start",
  );
  $("stop-button").hidden = !(state.connected || state.connecting);
  $("stop-button").disabled = state.stopping;
  $("mute-mic").hidden = !state.connected || state.mode === "video";
  $("mute-mic").setAttribute("aria-pressed", String(state.muted));
  $("mute-mic")
    .querySelector("use")
    .setAttribute("href", state.muted ? "#i-mic-off" : "#i-mic");
  $("mute-output").hidden = !state.connected;
  $("mute-output").setAttribute("aria-pressed", String(state.outputMuted));
  $("upload-zone").hidden = state.mode !== "video" || Boolean(state.file);
  const preview =
    (state.mode === "camera" && Boolean(capture.stream)) ||
    (state.mode === "video" && Boolean(state.file));
  $("media-preview").hidden = !preview;
  $("experience").classList.toggle("previewing", preview);
  $("media-preview").classList.toggle("camera", state.mode === "camera");
  $("replace-video").hidden = state.mode !== "video" || !state.file || busy;
  $("preview-label").textContent = t(
    state.mode === "camera"
      ? "yourView"
      : state.connected
        ? "watching"
        : "videoReady",
  );
  $("preview-video").controls = state.mode === "video" && !busy;
  const presenceKey = state.connecting
    ? "connecting"
    : state.phase === "speaking"
      ? "speaking"
      : state.connected
        ? state.mode === "video"
          ? "watching"
          : "listening"
        : state.mode === "video"
          ? "videoReady"
          : "presenceIdle";
  $("presence-label").textContent = t(presenceKey);
  let hint =
    state.mode === "camera"
      ? "cameraHint"
      : state.mode === "video"
        ? "videoHint"
        : "startHint";
  if (state.connected)
    hint =
      state.mode === "video"
        ? state.uploadState === "complete"
          ? "videoFinished"
          : "watching"
        : state.muted
          ? "mutedHint"
          : "liveHint";
  if (state.uploadState === "uploading") hint = "uploading";
  if (state.connecting) hint = "connecting";
  if (state.stopping) hint = "ending";
  $("control-hint").textContent = t(hint);
  const status = $("connection-state");
  status.classList.toggle("pending", state.connecting || state.stopping);
  status.classList.toggle("offline", !state.online);
  status.lastElementChild.textContent = state.stopping
    ? t("ending")
    : state.connecting
      ? t("connecting")
      : state.connected
        ? `${t("live")} · ${elapsed()}`
        : t(state.online ? "available" : "offline");
  $("reset-button").disabled = state.connecting || state.stopping;
  if (!state.transcript.size)
    $("caption-text").textContent = t(
      state.mode === "video" ? "videoHint" : "prompt",
    );
}
function elapsed() {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - state.startedAt) / 1000),
  );
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function setMode(mode) {
  if (state.connected || state.connecting || state.stopping) return;
  state.mode = mode;
  state.uploadState = "";
  $("preview-video").pause();
  $("preview-video").srcObject = null;
  if (mode === "video" && state.fileUrl) $("preview-video").src = state.fileUrl;
  else {
    $("preview-video").removeAttribute("src");
    $("preview-video").load();
  }
  $("video-name").textContent =
    mode === "video" && state.file ? state.file.name : "";
  $("video-time").textContent = "";
  render();
}
async function refreshStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw Error();
    const status = await response.json();
    state.online = true;
    return status;
  } catch {
    state.online = false;
    return null;
  } finally {
    render();
  }
}
async function startSession() {
  if (state.connected || state.connecting || state.stopping) return;
  if (state.mode === "video" && !state.file) {
    $("video-file").click();
    return;
  }
  // Unlock playback during the user's click, before any asynchronous network request.
  const primed = player.prime();
  state.connecting = true;
  const epoch = ++state.epoch;
  setPhase("connecting");
  try {
    await primed;
    const status = await refreshStatus();
    if (epoch !== state.epoch) return;
    if (!status) throw Error(t("network"));
    if (status.busy) throw Error(t("busy"));
    if (!status.configured) {
      state.connecting = false;
      setPhase("idle");
      await openSettings();
      notify(t("notConfigured"));
      return;
    }
    tasks.clear();
    clearTranscript();
    state.muted = false;
    state.uploadState = "";
    if (state.mode !== "video") {
      const started = await capture.start(state.mode, devices);
      if (!started || epoch !== state.epoch) return;
      render();
      void enumerateDevices();
    }
    if (epoch !== state.epoch) return;
    const ready = await connect(epoch);
    if (epoch !== state.epoch) return;
    state.sessionId = ready.session_id;
    state.token = ready.upload_token;
    state.connected = true;
    state.connecting = false;
    state.startedAt = Date.now();
    capture.active = true;
    setPhase("listening");
    if (state.mode === "video") await uploadVideo(epoch);
  } catch (error) {
    if (epoch !== state.epoch) return;
    notify(humanError(error), true);
    await stopSession().catch(() => {});
  }
}
function connect(epoch) {
  return new Promise((resolve, reject) => {
    const mode = state.mode === "audio" ? "audio" : "omni",
      source = state.mode === "video" ? "video" : "live";
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?mode=${mode}&source=${source}`,
    );
    state.socket = socket;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(Error(t("connectionFailed")));
        socket.close();
      }
    }, 180000);
    socket.onmessage = (event) => {
      if (epoch !== state.epoch) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "ready") {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(message);
        }
        return;
      }
      if (message.type === "fatal_error") {
        const error = Error(
          message.code === "busy"
            ? t("busy")
            : message.code === "configuration"
              ? t("notConfigured")
              : message.error || t("connectionFailed"),
        );
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        } else {
          notify(humanError(error), true);
          void stopSession().catch(() => {});
        }
        return;
      }
      if (message.type === "playback") player.enqueue(message);
      else if (message.type === "playback_end") player.finish(message.utterance_id);
      else if (message.type === "text")
        appendText(message.text, message.utterance_id);
      else if (message.type === "works") tasks.update(message.works);
      else if (message.type === "video_status") videoStatus(message);
      else if (message.type === "command_error") notify(message.error, true);
    };
    socket.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(Error(t("network")));
      }
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(Error(t("network")));
      }
      if (epoch === state.epoch && !state.stopping) {
        notify(t("network"), true);
        void stopSession(false).catch(() => {});
      }
    };
  });
}
async function stopSession(notifyServer = true) {
  if (state.stopping) return state.stopPromise;
  state.stopping = true;
  state.connecting = false;
  state.connected = false;
  state.epoch++;
  setPhase("ending");
  state.upload?.abort();
  state.upload = null;
  player.clear();
  capture.active = false;
  const socket = state.socket;
  state.stopPromise = (async () => {
    const stopped = capture.stop();
    try {
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.close();
            reject(Error(t("sessionClosing")));
          }, 45000);
          socket.addEventListener(
            "close",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          if (notifyServer && socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "stop_session" }));
          else socket.close();
        });
      }
      await stopped;
    } finally {
      state.socket = null;
      state.sessionId = null;
      state.token = null;
      state.stopping = false;
      state.uploadState = "";
      $("upload-progress").hidden = true;
      $("preview-video").pause();
      tasks.end();
      setPhase("idle");
      void refreshStatus();
    }
  })();
  try {
    await state.stopPromise;
  } catch (error) {
    notify(humanError(error), true);
    throw error;
  } finally {
    state.stopPromise = null;
  }
}
function selectFile(file) {
  if (!file || state.connected || state.connecting || state.stopping) return;
  if (file.size > 200 * 1024 * 1024) {
    notify(t("fileTooLarge"), true);
    return;
  }
  if (
    !file.type.startsWith("video/") &&
    !/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)
  ) {
    notify(t("invalidVideo"), true);
    return;
  }
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.file = file;
  state.fileUrl = URL.createObjectURL(file);
  setMode("video");
}
async function uploadVideo(epoch) {
  state.uploadState = "uploading";
  $("upload-progress").hidden = false;
  const bar = $("upload-progress").querySelector("span");
  bar.style.width = "0%";
  render();
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    state.upload = xhr;
    xhr.open(
      "POST",
      `/api/sessions/${encodeURIComponent(state.sessionId)}/video`,
    );
    xhr.setRequestHeader("X-Venus-Session-Token", state.token);
    xhr.setRequestHeader(
      "Content-Type",
      state.file.type || "application/octet-stream",
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        bar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
    };
    xhr.onload = () => {
      state.upload = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let detail;
        try {
          detail = JSON.parse(xhr.responseText).detail;
        } catch {}
        reject(Error(detail || t("videoFailed")));
      }
    };
    xhr.onerror = () => reject(Error(t("network")));
    xhr.onabort = () =>
      reject(Object.assign(Error("Upload cancelled"), { name: "AbortError" }));
    xhr.send(state.file);
  });
  if (epoch !== state.epoch) return;
  state.uploadState = "feeding";
  $("upload-progress").hidden = true;
  const video = $("preview-video");
  video.currentTime = 0;
  await video.play().catch(() => {});
  render();
}
function videoStatus(message) {
  state.uploadState = message.state;
  if (message.seconds !== undefined)
    $("video-time").textContent = `${message.seconds}s`;
  if (message.state === "feeding") {
    const video = $("preview-video");
    if (
      Number.isFinite(video.duration) &&
      Math.abs(video.currentTime - message.seconds) > 2
    )
      video.currentTime = Math.min(video.duration, message.seconds);
  }
  if (message.state === "complete") $("preview-video").pause();
  if (message.state === "error") {
    notify(t("videoFailed"), true);
    $("preview-video").pause();
  }
  render();
}
function clearTranscript() {
  state.transcript.clear();
  $("transcript").replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-copy";
  empty.dataset.i18n = "historyEmpty";
  empty.textContent = t("historyEmpty");
  $("transcript").append(empty);
  $("caption").classList.remove("has-speech");
  $("caption-speaker").hidden = true;
  $("caption-text").textContent = t("prompt");
}
function appendText(text, id) {
  if (!text) return;
  const key = id || `text-${state.transcript.size}`;
  let entry = state.transcript.get(key);
  if (!entry) {
    $("transcript").querySelector(".empty-copy")?.remove();
    const node = document.createElement("article");
    node.className = "transcript-entry";
    const heading = document.createElement("header");
    heading.textContent = "VENUS";
    const time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString(getLanguage(), {
      hour: "2-digit",
      minute: "2-digit",
    });
    heading.append(time);
    const paragraph = document.createElement("p");
    node.append(heading, paragraph);
    $("transcript").append(node);
    entry = { text: "", node, paragraph, time: Date.now() };
    state.transcript.set(key, entry);
  }
  entry.text += text;
  entry.paragraph.textContent = entry.text;
  $("caption").classList.add("has-speech");
  $("caption-speaker").hidden = false;
  $("caption-text").textContent = entry.text;
  $("caption-text").scrollTop = $("caption-text").scrollHeight;
  $("transcript").scrollTop = $("transcript").scrollHeight;
}
async function downloadArtifact(workId, artifact) {
  if (!state.sessionId || !state.token) {
    notify(t("noResult"));
    return;
  }
  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/works/${encodeURIComponent(workId)}/artifacts/${artifact.index}`,
      { headers: { "X-Venus-Session-Token": state.token } },
    );
    if (!response.ok) throw Error(t("noResult"));
    saveBlob(await response.blob(), artifact.name);
  } catch (error) {
    notify(humanError(error), true);
  }
}
function saveBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function enumerateDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const available = await navigator.mediaDevices.enumerateDevices();
    for (const [key, kind] of [
      ["microphone", "audioinput"],
      ["camera", "videoinput"],
    ]) {
      const select = $(key + "-device");
      select.replaceChildren(new Option(t("defaultDevice"), ""));
      for (const [i, device] of available
        .filter((value) => value.kind === kind)
        .entries())
        select.add(
          new Option(device.label || `${t(key)} ${i + 1}`, device.deviceId),
        );
      select.value = devices[key];
    }
  } catch {}
}
function updateRoutingOptions() {
  const options = $("auto-routing-options");
  const automatic = $("routing-mode").value === "auto";
  options.hidden = !automatic;
  options.disabled =
    !automatic || state.connected || state.connecting || state.stopping;
}
$("routing-mode").onchange = updateRoutingOptions;
async function openSettings() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw Error(t("notConfigured"));
    state.configuration = await response.json();
    const data = state.configuration.data;
    $("reply-language").value = data.language;
    $("length-penalty").value = data.duplex.length_penalty;
    $("backend-model").value = data.codex.model || "";
    $("backend-effort").value = data.codex.effort || "";
    $("routing-mode").value = data.routing.mode;
    $("routing-model").value = data.routing.model || "";
    $("routing-effort").value = data.routing.effort;
    $("routing-timeout").value = data.routing.timeout_s;
    $("response-model").value = data.responses.model || "";
    $("response-effort").value = data.responses.effort;
    $("backend-workspace").value = data.workspace;
    $("backend-binary").value = data.codex.command[0];
    await enumerateDevices();
    const busy = state.connected || state.connecting || state.stopping;
    for (const node of $("settings-form").querySelectorAll(
      "input,select,button",
    ))
      node.disabled = busy;
    updateRoutingOptions();
    $("settings-message").textContent = busy ? t("settingsActive") : "";
    $("settings-dialog").showModal();
  } catch (error) {
    notify(humanError(error), true);
  }
}
$("settings-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!state.configuration || state.connected) return;
  const button = $("save-settings");
  button.disabled = true;
  try {
    const data = structuredClone(state.configuration.data);
    data.language = $("reply-language").value;
    data.duplex.length_penalty = Number($("length-penalty").value);
    data.codex.model = $("backend-model").value.trim() || null;
    data.codex.effort = $("backend-effort").value || null;
    data.routing.mode = $("routing-mode").value;
    if (data.routing.mode === "auto") {
      data.routing.model = $("routing-model").value.trim() || null;
      data.routing.effort = $("routing-effort").value;
      data.routing.timeout_s = Number($("routing-timeout").value);
    }
    data.responses.model = $("response-model").value.trim() || null;
    data.responses.effort = $("response-effort").value;
    data.workspace = $("backend-workspace").value.trim();
    data.codex.command = [$("backend-binary").value.trim(), "app-server"];
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Venus-Config-Token": state.configuration.token,
      },
      body: JSON.stringify({ data, revision: state.configuration.revision }),
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(
        result.detail || result.problems?.join("; ") || t("notConfigured"),
      );
    state.configuration = result;
    devices.microphone = $("microphone-device").value;
    devices.camera = $("camera-device").value;
    try {
      localStorage.setItem("venus-devices", JSON.stringify(devices));
    } catch {}
    $("settings-dialog").close();
    notify(t("settingsSaved"));
    void refreshStatus();
  } catch (error) {
    $("settings-message").textContent = humanError(error);
  } finally {
    button.disabled = false;
  }
};
for (const button of document.querySelectorAll(".mode-button"))
  button.onclick = () => setMode(button.dataset.mode);
$("start-button").onclick = () => void startSession();
$("stop-button").onclick = () => void stopSession().catch(() => {});
$("mute-mic").onclick = () => {
  state.muted = !state.muted;
  capture.setMuted(state.muted);
  render();
};
$("mute-output").onclick = () => {
  state.outputMuted = !state.outputMuted;
  player.setMuted(state.outputMuted);
  render();
};
$("video-file").onchange = (event) => selectFile(event.target.files[0]);
$("replace-video").onclick = () => $("video-file").click();
$("upload-zone").onkeydown = (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("video-file").click();
  }
};
for (const name of ["dragenter", "dragover"])
  $("upload-zone").addEventListener(name, (event) => {
    event.preventDefault();
    $("upload-zone").classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  $("upload-zone").addEventListener(name, (event) => {
    event.preventDefault();
    $("upload-zone").classList.remove("dragging");
    if (name === "drop") selectFile(event.dataTransfer.files[0]);
  });
$("settings-button").onclick = () => void openSettings();
$("history-button").onclick = () => $("history-dialog").showModal();
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.querySelector(".dialog-close").onclick = () => dialog.close();
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  });
}
$("reset-button").onclick = async () => {
  const restart = state.connected;
  $("history-dialog").close();
  try {
    await player.prime();
    await stopSession();
    tasks.clear();
    clearTranscript();
    if (restart) await startSession();
    else notify(t("resetDone"));
  } catch {}
};
$("save-transcript").onclick = () => {
  if (!state.transcript.size) {
    notify(t("noTranscript"));
    return;
  }
  saveBlob(
    new Blob(
      [
        [...state.transcript.values()]
          .map(
            (entry) =>
              `Venus · ${new Date(entry.time).toLocaleString()}\n${entry.text}`,
          )
          .join("\n\n"),
      ],
      { type: "text/plain;charset=utf-8" },
    ),
    "Venus-conversation.txt",
  );
};
$("language-button").onclick = () =>
  setLanguage(getLanguage() === "en" ? "zh" : "en");
function renderTheme() {
  const label = t(document.documentElement.dataset.theme === "dark" ? "lightTheme" : "darkTheme");
  $("theme-button").setAttribute("aria-label", label);
  $("theme-button").title = label;
}
window.addEventListener("venus-theme", renderTheme);
window.addEventListener("venus-language", () => {
  renderTheme();
  render();
  void enumerateDevices();
});
window.addEventListener("pagehide", () => {
  state.epoch++;
  player.clear();
  state.upload?.abort();
  capture.stop();
  if (state.socket?.readyState === WebSocket.OPEN)
    send({ type: "stop_session" });
  state.socket?.close();
});
navigator.mediaDevices?.addEventListener?.(
  "devicechange",
  () => void enumerateDevices(),
);
setInterval(() => {
  if (state.connected) render();
}, 1000);
setInterval(() => {
  if (!state.connected && !state.connecting && !state.stopping)
    void refreshStatus();
}, 15000);
function animate(time) {
  presence.outputLevel = player.amplitude();
  if (microphoneWaveform.active && !document.hidden)
    microphoneWaveform.draw(capture.readWaveform(), time);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
renderTheme();
render();
void refreshStatus();
