(() => {
  "use strict";

  const CHANNEL = "coffeebean";
  const DEFAULT_CONFIG = {
    configVersion: 7,
    enabled: true,
    speed: "normal",
    frameRate: 120,
    controls: {
      step: "Space",
      pause: "KeyP",
      slow: "Digit1",
      normal: "Digit2",
      fast: "Digit3",
      quicksave: "KeyQ",
      quickload: "KeyW"
    },
    gameKeys: {
      left: "KeyA",
      right: "KeyD",
      action: "KeyJ",
      jump: "KeyK",
      respawn: "KeyR"
    },
    rng: { enabled: true, record: true, playback: true }
  };

  let latestStatus = {
    enabled: false,
    hooked: false,
    frame: 0,
    paused: false,
    speed: "normal",
    handlersReady: false,
    timePatched: false,
    playback: false
  };
  let requestId = 0;
  const pendingRequests = new Map();
  let activeConfig = DEFAULT_CONFIG;
  let replayConfigOnFirstStatus = true;

  function dispatchToPage(command) {
    document.dispatchEvent(new CustomEvent(`${CHANNEL}:command`, {
      detail: JSON.stringify(command)
    }));
  }

  function receiveStatus(status) {
    if (!status || typeof status !== "object") return;
    latestStatus = status;
  }

  document.addEventListener(`${CHANNEL}:status`, (event) => {
    try {
      receiveStatus(JSON.parse(event.detail));
      if (replayConfigOnFirstStatus) {
        replayConfigOnFirstStatus = false;
        setTimeout(() => dispatchToPage({ action: "configure", config: activeConfig }), 0);
      }
    } catch (_) {
      // Ignore malformed page events.
    }
  });
  document.addEventListener(`${CHANNEL}:response`, (event) => {
    try {
      const response = JSON.parse(event.detail);
      const pending = pendingRequests.get(response.id);
      if (!pending) return;
      pendingRequests.delete(response.id);
      clearTimeout(pending.timeout);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "Page request failed"));
    } catch (_) {}
  });

  function requestPage(command) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++requestId}`;
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("CoffeeBean page request timed out"));
      }, 120000);
      pendingRequests.set(id, { resolve, reject, timeout });
      document.dispatchEvent(new CustomEvent(`${CHANNEL}:request`, { detail: JSON.stringify({ id, command }) }));
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "command") {
      dispatchToPage(message.command || {});
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "status") {
      sendResponse(latestStatus);
      return true;
    }
    if (message.type === "request") {
      requestPage(message.command || {}).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });

  dispatchToPage({ action: "configure", config: DEFAULT_CONFIG });
  chrome.storage.sync.get({ coffeebeanConfig: DEFAULT_CONFIG }).then((result) => {
    const saved = result.coffeebeanConfig || DEFAULT_CONFIG;
    if (!saved.configVersion || saved.configVersion < 2) saved.gameKeys = Object.assign({}, DEFAULT_CONFIG.gameKeys);
    if (!saved.configVersion || saved.configVersion < 4) {
      saved.gameKeys = Object.assign({}, DEFAULT_CONFIG.gameKeys);
      saved.controls = Object.assign({}, saved.controls || {}, { step: "Space", quicksave: "KeyQ", quickload: "KeyW" });
    }
    if (!saved.configVersion || saved.configVersion < 7) {
      saved.gameKeys = Object.assign({}, saved.gameKeys || {}, { respawn: "KeyR" });
    }
    saved.frameRate = 120;
    saved.controls = Object.assign({}, DEFAULT_CONFIG.controls, saved.controls || {});
    delete saved.controls.reset;
    saved.gameKeys = Object.assign({}, DEFAULT_CONFIG.gameKeys, saved.gameKeys || {});
    saved.configVersion = 7;
    activeConfig = saved;
    dispatchToPage({ action: "configure", config: saved });
  }).catch(() => {});
})();
