(() => {
  "use strict";

  const CHANNEL = "coffeebean";
  const frame = document.getElementById("game-frame");
  const status = document.getElementById("status");
  const coffeeStatus = document.getElementById("coffee-status");
  const error = document.getElementById("error");
  const tasMode = document.getElementById("tas-mode");
  const projectStatus = document.getElementById("project-status");
  const slotSummary = document.getElementById("slot-summary");
  const frameRateInput = document.getElementById("frame-rate");
  const resetDialog = document.getElementById("reset-dialog");
  const viewButtons = {
    hitbox: document.getElementById("hitbox-view"),
    normal: document.getElementById("normal-view")
  };
  const runtimePaths = { hitbox: "game-hitbox.html", normal: "game.html" };
  let runtimeMode = "hitbox";
  let latestStatus = null;
  let childReady = false;
  let queuedConfig = null;
  let frameGeneration = 0;
  let currentRuntimeId = "--";
  let currentRuntimeStartedAt = 0;
  let pendingOperation = null;
  let bridgeRequestId = 0;

  const setRuntimeMode = (mode) => {
    if (!runtimePaths[mode]) return;
    if (pendingOperation) {
      setNotice("Wait for the current iframe operation to finish.", true);
      return;
    }
    runtimeMode = mode;
    for (const [name, button] of Object.entries(viewButtons)) {
      if (button) button.dataset.active = String(name === mode);
    }
    frame.title = mode === "hitbox" ? "IWPC game with hitboxes" : "IWPC clean production game";
    if (frame.getAttribute("src") !== runtimePaths[mode]) {
      childReady = false;
      latestStatus = null;
      frame.src = runtimePaths[mode];
      setNotice(mode === "hitbox" ? "TAS hitbox view selected" : "Clean production view selected");
    }
  };

  const setStatus = (text) => { status.textContent = text; };
  const setError = (value) => { error.textContent = value ? String(value) : ""; };
  const setNotice = (text, failed = false) => {
    projectStatus.textContent = text;
    projectStatus.style.color = failed ? "var(--danger)" : "var(--muted)";
  };
  const gameApi = () => {
    const api = frame.contentWindow && frame.contentWindow.__coffeeBean;
    if (!api) throw new Error("IWPC runtime is still starting");
    return api;
  };
  const focusGame = () => {
    try {
      frame.contentWindow.focus();
      frame.contentDocument.getElementById("game-canvas").focus();
    } catch (_) { frame.focus(); }
  };

  function finishPendingOperation(value) {
    const operation = pendingOperation;
    if (!operation || !operation.sawReload) return;
    if (value.playback) {
      operation.sawPlayback = true;
      if (operation.targetFrame == null) operation.targetFrame = Number(value.playbackTargetFrame);
      return;
    }
    const targetReached = operation.targetFrame == null || Number(value.frame) === operation.targetFrame;
    const modeReached = operation.mode === "play" ? !value.paused : !!value.paused;
    if (!targetReached || !modeReached || (!operation.sawPlayback && operation.targetFrame !== 0)) return;
    pendingOperation = null;
    window.clearTimeout(operation.timeout);
    operation.resolve({
      slot: operation.slot,
      frame: Number(value.frame),
      targetFrame: Number(value.frame),
      playing: operation.mode === "play",
      savestates: (value.savestates || []).filter(Boolean).length,
      rerecords: Number(value.rerecords) || 0,
      runtimeInstanceId: currentRuntimeId
    });
  }

  function setCoffeeStatus(value) {
    if (!value) { coffeeStatus.textContent = "CoffeeBean unavailable"; return; }
    latestStatus = value;
    const rngReady = value.rng && value.rng.detected;
    const rightInput = value.inputs && value.inputs.find((input) => input.action === "right");
    const quicksave = value.savestates && value.savestates[0];
    const usedSlots = value.savestates ? value.savestates.filter(Boolean).length : 0;
    const playbackLabel = value.playback ? `Playback ${value.frame}/${value.playbackTargetFrame}` : (value.paused ? "Paused" : "Running");
    coffeeStatus.textContent = `${playbackLabel} / ${value.frameRate || 120} FPS / RNG ${rngReady ? "ready" : "waiting"}`;
    coffeeStatus.dataset.frame = String(value.frame);
    coffeeStatus.dataset.coffeeVersion = value.version || "";
    coffeeStatus.dataset.paused = String(value.paused);
    coffeeStatus.dataset.rngDetected = String(!!rngReady);
    coffeeStatus.dataset.rngAddress = rngReady ? value.rng.address : "";
    coffeeStatus.dataset.rngState = rngReady ? value.rng.state : "";
    coffeeStatus.dataset.rngSeed = rngReady ? value.rng.seed : "";
    coffeeStatus.dataset.rngFrames = String(value.rngRecordedFrames || 0);
    coffeeStatus.dataset.rightState = rightInput ? rightInput.next : "";
    coffeeStatus.dataset.saveFrame = quicksave ? String(quicksave.frame) : "";
    coffeeStatus.title = rngReady ? `${value.rng.address} / next randf ${value.rng.nextRandf}` : (value.rng && value.rng.reason || "Waiting for Godot PCG32");
    document.getElementById("run-state").textContent = value.playback ? "PLAYBACK" : (value.paused ? "PAUSED" : "RUNNING");
    document.getElementById("takeover-run").disabled = !value.playback || !value.paused;
    document.getElementById("frame-value").textContent = String(value.frame);
    document.getElementById("playback-value").textContent = value.playback ? `${String(value.playbackMode || "load").toUpperCase()} ${value.frame}/${value.playbackTargetFrame}` : "RECORD";
    document.getElementById("speed-value").textContent = value.playback && value.speed === "fast" ? "FAST REPLAY" : (value.paused ? "paused" : value.speed);
    document.getElementById("actual-fps-value").textContent = `${value.paused ? 0 : (value.measuredFrameRate || 0)} Hz`;
    if (document.activeElement !== frameRateInput) frameRateInput.value = "120";
    document.getElementById("rerecord-value").textContent = String(value.rerecords || 0);
    document.getElementById("rng-mode").textContent = rngReady ? `${value.rngRecordedFrames || 0} captured` : "waiting";
    document.getElementById("rng-address").textContent = rngReady ? value.rng.address : "--";
    document.getElementById("rng-seed").textContent = rngReady ? value.rng.seed : "--";
    document.getElementById("rng-state").textContent = rngReady ? value.rng.state : "--";
    for (const input of value.inputs || []) {
      const indicator = document.querySelector(`[data-tas-input="${input.action}"]`);
      if (indicator) indicator.dataset.state = String(input.next || "neutral").toLowerCase();
    }
    for (const row of document.querySelectorAll("[data-state-slot]")) {
      const index = Number(row.dataset.stateSlot);
      const saved = value.savestates && value.savestates[index];
      row.dataset.filled = String(!!saved);
      row.querySelector(".state-meta").textContent = saved ? `F${saved.frame} / ${saved.actions || 0}K / ${saved.mouseActions || 0}M / ${saved.rngFrames || 0}R` : "Empty";
      row.querySelector('[data-slot-action="save"]').disabled = !!value.savestateBusy;
      row.querySelector('[data-slot-action="load"]').disabled = !!value.savestateBusy || !saved;
      row.querySelector('[data-slot-action="play"]').disabled = !!value.savestateBusy || !saved;
    }
    slotSummary.textContent = value.playback
      ? `${value.speed === "fast" ? "FAST " : ""}PLAYBACK ${value.frame}/${value.playbackTargetFrame} / ${Math.round((value.playbackProgress || 0) * 100)}%`
      : `${usedSlots}/8 replay checkpoints used`;
    tasMode.textContent = value.playback ? `PLAYBACK / FRAME ${value.frame} OF ${value.playbackTargetFrame}` : `${value.paused ? "PAUSED" : "RUNNING"} / FRAME ${value.frame}`;
    finishPendingOperation(value);
    document.dispatchEvent(new CustomEvent(`${CHANNEL}:status`, { detail: JSON.stringify(value) }));
  }

  function startReloadOperation(method, args, mode, slot, targetFrame) {
    if (pendingOperation) return Promise.reject(new Error("Another game reload is still running"));
    return new Promise((resolve, reject) => {
      const operation = {
        mode,
        slot,
        targetFrame,
        startGeneration: frameGeneration,
        sawReload: false,
        sawPlayback: false,
        resolve,
        reject,
        timeout: window.setTimeout(() => {
          if (pendingOperation !== operation) return;
          pendingOperation = null;
          reject(new Error("IWPC iframe replay timed out"));
        }, 120000)
      };
      pendingOperation = operation;
      try {
        const childResult = gameApi()[method](...args);
        Promise.resolve(childResult).catch((reason) => {
          if (pendingOperation !== operation || operation.sawReload) return;
          pendingOperation = null;
          window.clearTimeout(operation.timeout);
          reject(reason);
        });
      } catch (reason) {
        pendingOperation = null;
        window.clearTimeout(operation.timeout);
        reject(reason);
      }
    });
  }

  const proxy = {
    version: "0.9.10",
    getStatus: () => latestStatus,
    configure(config) {
      queuedConfig = config;
      if (childReady) gameApi().configure(config);
    },
    command(action) {
      if (action === "quickload") return proxy.loadState(0);
      return gameApi().command(action);
    },
    saveState: (slot) => gameApi().saveState(slot),
    loadState(slot) {
      const saved = latestStatus && latestStatus.savestates && latestStatus.savestates[slot];
      return startReloadOperation("loadState", [slot], "load", slot, saved ? Number(saved.frame) : null);
    },
    playState(slot) {
      const saved = latestStatus && latestStatus.savestates && latestStatus.savestates[slot];
      return startReloadOperation("playState", [slot], "play", slot, saved ? Number(saved.frame) : null);
    },
    setFrameRate: (value) => gameApi().setFrameRate(value),
    beginRecording: () => gameApi().beginRecording(),
    exportTas: () => gameApi().exportTas(),
    loadTas: (tas) => startReloadOperation("loadTas", [tas], "load", -1, null),
    getRng: () => gameApi().getRng(),
    setRngSeed: (value) => gameApi().setRngSeed(value),
    setRngState: (value) => gameApi().setRngState(value),
    setTap: (action) => gameApi().setTap(action),
    takeoverPlayback() {
      const childResult = gameApi().takeoverPlayback();
      const result = Object.assign({
        savestates: latestStatus && latestStatus.savestates ? latestStatus.savestates.filter(Boolean).length : 0,
        runtimeInstanceId: currentRuntimeId
      }, childResult);
      const operation = pendingOperation;
      if (operation) {
        pendingOperation = null;
        window.clearTimeout(operation.timeout);
        operation.resolve(result);
      }
      return result;
    },
    exportProject: () => gameApi().exportProject(),
    downloadProject: (filename) => gameApi().downloadProject(filename),
    importProject: (source) => startReloadOperation("importProject", [source], "load", -1, null)
  };
  window.__coffeeBean = proxy;

  frame.addEventListener("load", () => {
    frameGeneration++;
    childReady = false;
    setStatus(frameGeneration === 1 ? "Starting IWPC..." : "Reloading IWPC...");
    if (pendingOperation && frameGeneration > pendingOperation.startGeneration) pendingOperation.sawReload = true;
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === "status") {
      try { setCoffeeStatus(JSON.parse(message.detail)); } catch (_) {}
    } else if (message.type === "engine") {
      const engine = typeof message.detail === "string" ? { text: message.detail } : message.detail;
      if (engine.runtimeId) currentRuntimeId = engine.runtimeId;
      if (engine.runtimeStartedAt) currentRuntimeStartedAt = Number(engine.runtimeStartedAt);
      setStatus(engine.text || "IWPC runtime");
      document.getElementById("instance-value").textContent = currentRuntimeId;
      document.getElementById("instance-value").title = currentRuntimeStartedAt ? new Date(currentRuntimeStartedAt).toISOString() : "";
    } else if (message.type === "error") {
      setError(message.detail);
    } else if (message.type === "reset-request") {
      if (!resetDialog.open) resetDialog.showModal();
    } else if (message.type === "ready") {
      if (message.detail && message.detail.runtimeId) currentRuntimeId = message.detail.runtimeId;
      if (message.detail && message.detail.runtimeStartedAt) currentRuntimeStartedAt = Number(message.detail.runtimeStartedAt);
      childReady = true;
      setStatus("IWPC running");
      document.getElementById("instance-value").textContent = currentRuntimeId;
      if (queuedConfig) gameApi().configure(queuedConfig);
      const childStatus = gameApi().getStatus();
      if (childStatus) setCoffeeStatus(childStatus);
    }
  });

  function handleBridgeCommand(command) {
    if (!command || typeof command !== "object") throw new Error("Invalid CoffeeBean command");
    if (command.action === "configure") return proxy.configure(command.config);
    if (command.action === "load") return proxy.loadTas(command.video);
    if (command.action === "new-recording") return proxy.command("reset-confirmed");
    if (command.action === "rng-seed") return proxy.setRngSeed(command.value);
    if (command.action === "rng-state") return proxy.setRngState(command.value);
    if (command.action === "tap") return proxy.setTap(command.input);
    if (command.action === "takeover") return proxy.takeoverPlayback();
    if (command.action === "save-state") return proxy.saveState(command.slot);
    if (command.action === "load-state") return proxy.loadState(command.slot);
    if (command.action === "play-state") return proxy.playState(command.slot);
    if (command.action === "status") return proxy.getStatus();
    if (command.action === "export") return { tas: proxy.exportTas(), frames: latestStatus && latestStatus.frame || 0, rngFrames: latestStatus && latestStatus.rngRecordedFrames || 0 };
    return proxy.command(command.action);
  }
  document.addEventListener(`${CHANNEL}:command`, (event) => {
    try { void Promise.resolve(handleBridgeCommand(JSON.parse(event.detail))).catch(() => {}); } catch (_) {}
  });
  document.addEventListener(`${CHANNEL}:request`, (event) => {
    let request = null;
    try {
      request = JSON.parse(event.detail);
      Promise.resolve(handleBridgeCommand(request.command)).then((result) => {
        document.dispatchEvent(new CustomEvent(`${CHANNEL}:response`, { detail: JSON.stringify({ id: request.id, ok: true, result }) }));
      }).catch((reason) => {
        document.dispatchEvent(new CustomEvent(`${CHANNEL}:response`, { detail: JSON.stringify({ id: request.id, ok: false, error: reason && reason.message ? reason.message : String(reason) }) }));
      });
    } catch (reason) {
      document.dispatchEvent(new CustomEvent(`${CHANNEL}:response`, { detail: JSON.stringify({ id: request && request.id || `workspace-${++bridgeRequestId}`, ok: false, error: reason && reason.message ? reason.message : String(reason) }) }));
    }
  });

  const forwardedCodes = new Set(["KeyA", "KeyD", "KeyJ", "KeyK", "KeyP", "KeyQ", "KeyW", "KeyR", "Space", "Digit1", "Digit2", "Digit3"]);
  const forwardKey = (event, down) => {
    if (!childReady || !forwardedCodes.has(event.code) || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    const childEvent = new frame.contentWindow.KeyboardEvent(down ? "keydown" : "keyup", {
      bubbles: true,
      cancelable: true,
      code: event.code,
      key: event.key,
      repeat: event.repeat
    });
    frame.contentWindow.dispatchEvent(childEvent);
  };
  window.addEventListener("keydown", (event) => forwardKey(event, true), true);
  window.addEventListener("keyup", (event) => forwardKey(event, false), true);

  document.getElementById("savestate-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-slot-action]");
    if (!button || button.disabled) return;
    const slot = Number(button.closest("[data-state-slot]").dataset.stateSlot);
    try {
      let result;
      if (button.dataset.slotAction === "save") result = await proxy.saveState(slot);
      if (button.dataset.slotAction === "load") { setNotice(`Reloading iframe and replaying slot ${slot + 1}...`); result = await proxy.loadState(slot); }
      if (button.dataset.slotAction === "play") { setNotice(`Reloading iframe and replaying slot ${slot + 1}...`); result = await proxy.playState(slot); }
      const verb = button.dataset.slotAction === "save" ? "Saved" : (button.dataset.slotAction === "load" ? "Loaded" : "Playing");
      const instance = button.dataset.slotAction === "save" ? "" : ` / instance ${result.runtimeInstanceId}`;
      setNotice(`${verb} slot ${slot + 1} at frame ${result.frame}${instance}`);
      focusGame();
    } catch (reason) { setNotice(reason && reason.message ? reason.message : String(reason), true); }
  });

  document.querySelectorAll("[data-tas-input]").forEach((indicator) => {
    indicator.addEventListener("click", () => {
      try {
        const queued = proxy.setTap(indicator.dataset.tasInput);
        setNotice(queued ? `Tap queued: ${indicator.dataset.tasInput}` : "Tap ignored while input is held", !queued);
        focusGame();
      } catch (reason) {
        setNotice(reason && reason.message ? reason.message : String(reason), true);
      }
    });
  });

  const applyFrameRate = () => {
    if (!frameRateInput.value || !childReady) return;
    try {
      const applied = proxy.setFrameRate(120);
      frameRateInput.value = "120";
      setNotice(`Godot project frame rate locked to ${applied} FPS`);
    } catch (reason) { setNotice(reason && reason.message ? reason.message : String(reason), true); }
  };
  frameRateInput.addEventListener("input", applyFrameRate);
  frameRateInput.addEventListener("change", applyFrameRate);

  document.getElementById("reset-run").addEventListener("click", () => {
    if (!resetDialog.open) resetDialog.showModal();
  });
  document.getElementById("takeover-run").addEventListener("click", () => {
    try {
      const result = proxy.takeoverPlayback();
      setNotice(`Recording takeover at frame ${result.frame}`);
      focusGame();
    } catch (reason) { setNotice(reason && reason.message ? reason.message : String(reason), true); }
  });
  viewButtons.hitbox?.addEventListener("click", () => setRuntimeMode("hitbox"));
  viewButtons.normal?.addEventListener("click", () => setRuntimeMode("normal"));
  document.getElementById("confirm-reset").addEventListener("click", () => {
    try {
      proxy.command("reset-confirmed");
      setNotice("Run reset to paused frame 0");
      focusGame();
    } catch (reason) { setNotice(reason && reason.message ? reason.message : String(reason), true); }
  });

  const projectFile = document.getElementById("project-file");
  document.getElementById("save-project").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setNotice("Packing project...");
    try {
      const result = await proxy.downloadProject();
      setNotice(`${result.filename} / frame ${result.frame} / ${result.savestates}/8 slots / ${(result.bytes / 1048576).toFixed(1)} MiB`);
    } catch (reason) { setNotice(reason && reason.message ? reason.message : String(reason), true); }
    finally { button.disabled = false; }
  });
  document.getElementById("open-project").addEventListener("click", () => projectFile.click());
  projectFile.addEventListener("change", async () => {
    const file = projectFile.files && projectFile.files[0];
    if (!file) return;
    setNotice("Opening project...");
    try {
      const result = await proxy.importProject(file);
      setNotice(`${file.name} / frame ${result.frame} / ${result.savestates}/8 slots`);
    } catch (reason) { setNotice(reason && reason.message ? reason.message : String(reason), true); }
    projectFile.value = "";
  });
})();
