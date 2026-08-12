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

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("coffeebeanConfig");
  if (!stored.coffeebeanConfig) {
    await chrome.storage.sync.set({ coffeebeanConfig: DEFAULT_CONFIG });
  }
});
