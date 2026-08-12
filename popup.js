(() => {
  "use strict";

  const DEFAULT_CONFIG = {
    configVersion: 7,
    enabled: true,
    speed: "normal",
    frameRate: 120,
    controls: { step: "Space", pause: "KeyP", slow: "Digit1", normal: "Digit2", fast: "Digit3", quicksave: "KeyQ", quickload: "KeyW" },
    gameKeys: { left: "KeyA", right: "KeyD", action: "KeyJ", jump: "KeyK", respawn: "KeyR" },
    rng: { enabled: true, record: true, playback: true }
  };
  const CONTROL_LABELS = { step: "Step", pause: "Pause", normal: "Normal", quicksave: "Quick save", quickload: "Quick load" };
  const GAME_LABELS = { left: "Left", right: "Right", action: "Attack", jump: "Jump", respawn: "Respawn" };
  let config = clone(DEFAULT_CONFIG);
  let activeTabId = null;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function codeLabel(code) {
    const names = { Space: "Space", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Escape: "Esc", Enter: "Enter", Backquote: "`" };
    if (names[code]) return names[code];
    if (code && code.startsWith("Key")) return code.slice(3);
    if (code && code.startsWith("Digit")) return code.slice(5);
    return code || "Set key";
  }
  function buildKeys(id, source, labels) {
    const root = document.getElementById(id);
    root.replaceChildren();
    Object.keys(labels).forEach((key) => {
      const row = document.createElement("div");
      row.className = "key-row";
      const label = document.createElement("label");
      label.textContent = labels[key];
      const input = document.createElement("input");
      input.className = "key-input";
      input.type = "text";
      input.readOnly = true;
      input.dataset.group = id === "controlKeys" ? "controls" : "gameKeys";
      input.dataset.key = key;
      input.value = codeLabel(source[key]);
      input.title = "Press a key to assign";
      input.addEventListener("keydown", (event) => {
        event.preventDefault();
        source[key] = event.code;
        input.value = codeLabel(event.code);
      });
      input.addEventListener("click", () => input.focus());
      row.append(label, input);
      root.append(row);
    });
  }
  function renderForm() {
    document.getElementById("enabled").checked = !!config.enabled;
    config.speed = "normal";
    document.getElementById("speed").value = "normal";
    document.getElementById("speed").disabled = true;
    document.getElementById("frameRate").value = "120";
    document.getElementById("frameRate").readOnly = true;
    document.getElementById("rngRecord").checked = !!config.rng.record;
    document.getElementById("rngPlayback").checked = !!config.rng.playback;
    buildKeys("controlKeys", config.controls, CONTROL_LABELS);
    buildKeys("gameKeys", config.gameKeys, GAME_LABELS);
  }
  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }
  async function send(command) {
    const tab = await getActiveTab();
    activeTabId = tab && tab.id;
    if (!activeTabId) return null;
    try {
      return await chrome.tabs.sendMessage(activeTabId, { type: "command", command });
    } catch (_) {
      return null;
    }
  }
  async function request(command) {
    const tab = await getActiveTab();
    activeTabId = tab && tab.id;
    if (!activeTabId) throw new Error("No active tab");
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "request", command });
    if (!response || !response.ok) throw new Error(response && response.error ? response.error : "CoffeeBean is unavailable");
    return response.result;
  }
  function setNotice(message, error = false) {
    const output = document.getElementById("saveState");
    output.textContent = message;
    output.classList.toggle("error", error);
    clearTimeout(setNotice.timeout);
    setNotice.timeout = setTimeout(() => { output.textContent = ""; output.classList.remove("error"); }, 2200);
  }
  async function refreshStatus() {
    const tab = await getActiveTab();
    activeTabId = tab && tab.id;
    if (!activeTabId) return;
    let status = null;
    try { status = await chrome.tabs.sendMessage(activeTabId, { type: "status" }); } catch (_) {}
    if (!status) {
      document.getElementById("connectionText").textContent = "No supported page";
      document.getElementById("connectionDot").classList.remove("live");
      return;
    }
    document.getElementById("connectionText").textContent = status.enabled ? "CoffeeBean active" : "CoffeeBean paused";
    document.getElementById("connectionDot").classList.toggle("live", !!status.hooked && !!status.enabled);
    document.getElementById("frame").textContent = String(status.frame || 0);
    document.getElementById("mode").textContent = status.playback ? `Playback ${status.frame}/${status.playbackTargetFrame}` : (status.paused ? "Paused" : (status.speed || "normal").replace(/^./, (x) => x.toUpperCase()));
    document.getElementById("fps").textContent = String(status.frameRate || 120);
    document.getElementById("hook").textContent = status.hooked ? (status.timePatched ? "Ready" : "Partial") : "Waiting";
    document.getElementById("takeover").disabled = !status.playback || !status.paused;
    const rng = status.rng || {};
    const rngStatus = document.getElementById("rngStatus");
    rngStatus.textContent = rng.detected ? "PCG32 READY" : "WAITING";
    rngStatus.classList.toggle("ready", !!rng.detected);
    rngStatus.title = rng.detected ? `${rng.address} / ${rng.reason}` : (rng.reason || "Godot PCG32 not detected");
    document.getElementById("rngSeedValue").textContent = rng.seed || "--";
    document.getElementById("rngStateValue").textContent = rng.state || "--";
    document.getElementById("rngNext").textContent = rng.nextRandf || "--";
    document.getElementById("rngFrames").textContent = `${status.rngRecordedFrames || 0} frames`;
    if (rng.detected && document.activeElement !== document.getElementById("rngSeed")) document.getElementById("rngSeed").value = rng.seed || "";
    if (rng.detected && document.activeElement !== document.getElementById("rngState")) document.getElementById("rngState").value = rng.state || "";
    const inputStates = new Map((status.inputs || []).map((input) => [input.action, input]));
    document.querySelectorAll("[data-input-state]").forEach((element) => {
      const input = inputStates.get(element.dataset.inputState);
      const state = input ? (input.next || input.state) : "Neutral";
      element.textContent = state;
      element.dataset.state = state.toLowerCase();
    });
    const slot = Number(document.getElementById("stateSlot").value) || 0;
    const saved = status.savestates && status.savestates[slot];
    document.getElementById("stateInfo").textContent = saved ? `Frame ${saved.frame} / ${saved.actions || 0} keys / ${saved.mouseActions || 0} mouse / ${saved.rngFrames || 0} RNG / ${status.rerecords || 0} rerecords` : "Empty slot";
  }

  chrome.storage.sync.get({ coffeebeanConfig: DEFAULT_CONFIG }).then((result) => {
    const saved = result.coffeebeanConfig || {};
    if (!saved.configVersion || saved.configVersion < 2) saved.gameKeys = clone(DEFAULT_CONFIG.gameKeys);
    if (!saved.configVersion || saved.configVersion < 4) {
      saved.gameKeys = clone(DEFAULT_CONFIG.gameKeys);
      saved.controls = Object.assign({}, saved.controls || {}, { step: "Space", quicksave: "KeyQ", quickload: "KeyW" });
    }
    if (!saved.configVersion || saved.configVersion < 7) saved.gameKeys = Object.assign({}, saved.gameKeys || {}, { respawn: "KeyR" });
    saved.frameRate = 120;
    config = Object.assign(clone(DEFAULT_CONFIG), saved);
    config.configVersion = 7;
    config.controls = Object.assign(clone(DEFAULT_CONFIG.controls), config.controls || {});
    delete config.controls.reset;
    config.gameKeys = Object.assign(clone(DEFAULT_CONFIG.gameKeys), config.gameKeys || {});
    config.rng = Object.assign(clone(DEFAULT_CONFIG.rng), config.rng || {});
    renderForm();
    refreshStatus();
  });
  document.getElementById("enabled").addEventListener("change", (event) => { config.enabled = event.target.checked; send({ action: "configure", config }); });
  document.getElementById("speed").addEventListener("change", (event) => { event.target.value = "normal"; config.speed = "normal"; send({ action: "configure", config }); });
  document.getElementById("frameRate").addEventListener("change", (event) => {
    config.frameRate = 120;
    event.target.value = "120";
    send({ action: "configure", config });
  });
  document.getElementById("rngRecord").addEventListener("change", (event) => { config.rng.record = event.target.checked; send({ action: "configure", config }); });
  document.getElementById("rngPlayback").addEventListener("change", (event) => { config.rng.playback = event.target.checked; send({ action: "configure", config }); });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => send({ action: button.dataset.action })));
  document.getElementById("applySeed").addEventListener("click", async () => {
    try { await request({ action: "rng-seed", value: document.getElementById("rngSeed").value }); setNotice("Seed applied"); await refreshStatus(); }
    catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("applyState").addEventListener("click", async () => {
    try { await request({ action: "rng-state", value: document.getElementById("rngState").value }); setNotice("State applied"); await refreshStatus(); }
    catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("copyTas").addEventListener("click", async () => {
    try {
      const exported = await request({ action: "export" });
      const field = document.getElementById("tasData");
      field.value = exported.tas;
      field.select();
      try { await navigator.clipboard.writeText(exported.tas); } catch (_) { document.execCommand("copy"); }
      setNotice(`Copied ${exported.frames}f`);
    } catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("loadTas").addEventListener("click", async () => {
    try {
      const loaded = await request({ action: "load", video: document.getElementById("tasData").value });
      setNotice(`Loaded ${loaded.frames}f`);
    } catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("saveSlot").addEventListener("click", async () => {
    try {
      const saved = await request({ action: "save-state", slot: Number(document.getElementById("stateSlot").value) });
      setNotice(`Saved ${saved.frame}f`);
      await refreshStatus();
    } catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("loadSlot").addEventListener("click", async () => {
    try {
      const loaded = await request({ action: "load-state", slot: Number(document.getElementById("stateSlot").value) });
      setNotice(`Loaded ${loaded.frame}f`);
      await refreshStatus();
    } catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("playSlot").addEventListener("click", async () => {
    try {
      const played = await request({ action: "play-state", slot: Number(document.getElementById("stateSlot").value) });
      setNotice(`Playing from ${played.frame}f`);
      await refreshStatus();
    } catch (error) { setNotice(error.message, true); }
  });
  document.getElementById("stateSlot").addEventListener("change", refreshStatus);
  document.getElementById("save").addEventListener("click", async () => {
    config.enabled = document.getElementById("enabled").checked;
    config.speed = "normal";
    config.frameRate = 120;
    config.rng.record = document.getElementById("rngRecord").checked;
    config.rng.playback = document.getElementById("rngPlayback").checked;
    await chrome.storage.sync.set({ coffeebeanConfig: config });
    await send({ action: "configure", config });
    setNotice("Applied");
  });
  setInterval(refreshStatus, 700);
})();
