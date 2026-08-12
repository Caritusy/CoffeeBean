(() => {
  "use strict";

  if (window === window.top && /\/game\/iwpc\/index\.html$/i.test(window.location && window.location.pathname || "")) return;
  if (window.__coffeeBean) return;

  const CHANNEL = "coffeebean";
  const VERSION = "0.9.8";
  const PENDING_RELOAD_KEY = `${CHANNEL}:pending-reload`;
  // IWPC's project.binary stores physics/common/physics_ticks_per_second = 120.
  // TAS frames are Godot physics ticks, not a user-selected monitor rate.
  const PROJECT_FRAME_RATE = 120;
  const PROJECT_MAGIC = new Uint8Array([67, 66, 80, 82, 79, 74, 50, 10]);
  const DEFAULT_CONFIG = {
    configVersion: 7,
    enabled: true,
    speed: "normal",
    frameRate: PROJECT_FRAME_RATE,
    controls: { step: "Space", pause: "KeyP", slow: "Digit1", normal: "Digit2", fast: "Digit3", quicksave: "KeyQ", quickload: "KeyW" },
    gameKeys: { left: "KeyA", right: "KeyD", action: "KeyJ", jump: "KeyK", respawn: "KeyR" },
    rng: { enabled: true, record: true, playback: true }
  };
  const ACTION_CODES = ["left", "right", "action", "jump", "respawn"];
  const LEGACY_ACTION_CODES = ["left", "up", "right", "down", "action", "space"];
  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const nativePerformance = window.performance;
  const nativeNow = nativePerformance && typeof nativePerformance.now === "function"
    ? nativePerformance.now.bind(nativePerformance)
    : () => Date.now();
  const nativeRaf = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(() => callback(nativeNow()), 16);
  const FAST_FRAME_BATCH = 1;
  const FAST_SPEED_MULTIPLIER = 2;
  const immediateFrameQueue = [];
  let immediateFrameDraining = false;
  const immediateFrameChannel = typeof window.MessageChannel === "function" ? new window.MessageChannel() : null;
  if (immediateFrameChannel) {
    immediateFrameChannel.port1.onmessage = () => {
      immediateFrameDraining = true;
      try {
        for (let index = 0; index < FAST_FRAME_BATCH && immediateFrameQueue.length; index++) {
          immediateFrameQueue.shift()();
        }
      } finally {
        immediateFrameDraining = false;
      }
      if (immediateFrameQueue.length) immediateFrameChannel.port2.postMessage(0);
    };
  }

  let config = clone(DEFAULT_CONFIG);
  let control = { frame: 0, paused: false, speed: 1 };
  let playbackSpeed = "normal";
  let fakeTime = nativeNow();
  let recordingStartTime = fakeTime;
  let frameRate = PROJECT_FRAME_RATE;
  let frameLength = 1000 / frameRate;
  let nextFrameDeadline = null;
  let measuredFrameRate = 0;
  let rateWindowStart = nativeNow();
  let rateWindowFrames = 0;
  let pausedCallback = null;
  let lastRafCallback = null;
  let rafPending = false;
  let stepBudget = 0;
  let pumpingStep = false;
  let playback = null;
  let playbackSession = null;
  let slots = new Array(10).fill(null);
  let stateSlots = new Array(8).fill(null);
  let stateBusy = false;
  let fullgameVideo = null;
  let initialDirection = 0;
  let keydownHandler = null;
  let keyupHandler = null;
  let timePatched = false;
  let rafPatched = false;
  let renderPatched = false;
  let lastStatus = null;
  let lastStatusEmit = 0;
  let statusEmitTimer = null;
  let rerecords = 0;
  let pendingReloadPlayback = null;
  const syntheticEvents = new WeakSet();
  const syntheticPointerEvents = new WeakSet();
  let recorder;
  let rng;

  try {
    const pending = window.sessionStorage && window.sessionStorage.getItem(PENDING_RELOAD_KEY);
    if (pending) pendingReloadPlayback = JSON.parse(pending);
    if (window.sessionStorage) window.sessionStorage.removeItem(PENDING_RELOAD_KEY);
  } catch (_) {
    pendingReloadPlayback = null;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalizeFrameRate(value) {
    const parsed = Number(value);
    return PROJECT_FRAME_RATE;
  }
  function normalizeConfig(next) {
    const incoming = next || {};
    const controls = Object.assign({}, DEFAULT_CONFIG.controls, incoming.controls || {});
    delete controls.reset;
    config = {
      configVersion: 7,
      enabled: incoming.enabled !== false,
      speed: "normal",
      frameRate: PROJECT_FRAME_RATE,
      controls,
      gameKeys: Object.assign({}, DEFAULT_CONFIG.gameKeys, incoming.gameKeys || {}),
      rng: Object.assign({}, DEFAULT_CONFIG.rng, incoming.rng || {})
    };
    frameRate = config.frameRate;
    frameLength = 1000 / frameRate;
    playbackSpeed = config.speed;
    if (!control.paused) control.speed = speedValue(playbackSpeed);
  }
  function speedValue(speed) { return speed === "slow" ? 0 : (speed === "fast" ? 2 : 1); }
  function keyCodeFor(code) {
    const named = {
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32,
      Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46,
      ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17,
      AltLeft: 18, AltRight: 18, NumpadEnter: 13, Numpad0: 96, Numpad1: 97,
      Numpad2: 98, Numpad3: 99, Numpad4: 100, Numpad5: 101, Numpad6: 102,
      Numpad7: 103, Numpad8: 104, Numpad9: 105
    };
    if (named[code]) return named[code];
    if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
    if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) return 111 + Number(code.slice(1));
    return 0;
  }
  function gameKeyCodes() { return ACTION_CODES.map((key) => keyCodeFor(config.gameKeys[key])); }
  function codeFromEvent(event) { return event.code || keyCodeToCode(event.keyCode); }
  function keyCodeToCode(keyCode) {
    const known = { 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown", 32: "Space", 13: "Enter", 27: "Escape" };
    if (known[keyCode]) return known[keyCode];
    if (keyCode >= 65 && keyCode <= 90) return `Key${String.fromCharCode(keyCode)}`;
    if (keyCode >= 48 && keyCode <= 57) return `Digit${keyCode - 48}`;
    return "";
  }
  function emitStatus(throttle = false) {
    const emittedAt = nativeNow();
    if (throttle && emittedAt - lastStatusEmit < 100) {
      if (statusEmitTimer === null) {
        statusEmitTimer = window.setTimeout(() => {
          statusEmitTimer = null;
          emitStatus();
        }, Math.max(0, 100 - (emittedAt - lastStatusEmit)));
      }
      return;
    }
    if (statusEmitTimer !== null) {
      window.clearTimeout(statusEmitTimer);
      statusEmitTimer = null;
    }
    lastStatusEmit = emittedAt;
    const status = {
      version: VERSION,
      enabled: config.enabled,
      hooked: rafPatched,
      frame: control.frame,
      paused: control.paused,
      speed: control.speed === 0 ? "slow" : (control.speed === 2 ? "fast" : "normal"),
      handlersReady: (!!keydownHandler && !!keyupHandler) || !!document.querySelector("canvas"),
      timePatched,
      renderPatched,
      playback: !!playback,
      playbackMode: playbackSession ? playbackSession.mode : null,
      playbackTargetFrame: playbackSession ? playbackSession.targetFrame : null,
      playbackProgress: playbackSession ? Math.min(1, control.frame / Math.max(1, playbackSession.targetFrame)) : null,
      frameRate: PROJECT_FRAME_RATE,
      frameLength,
      measuredFrameRate: Math.round(measuredFrameRate * 10) / 10,
      stepBudget,
      inputs: recorder ? ACTION_CODES.map((action, index) => ({ action, state: recorder.frameStates[index], next: nextInputState(index), held: recorder.keyStates[index], targetHeld: recorder.physicalStates[index] })) : [],
      mouseActions: recorder ? recorder.video.mouseActions.length : 0,
      savestates: stateSlots.map((slot, index) => slot ? { slot: index, frame: slot.frame, actions: slot.video.actions.length, mouseActions: slot.video.mouseActions.length, rngFrames: slot.rngRecordedFrames, rerecords: slot.rerecords } : null),
      savestateBusy: stateBusy,
      rerecords,
      rng: rng ? rng.getStatus() : { detected: false, reason: "initializing" },
      rngRecordedFrames: recorder ? recorder.rngRecordedFrames : 0,
      url: String(window.location.href)
    };
    lastStatus = status;
    const serialized = JSON.stringify(status);
    document.dispatchEvent(new CustomEvent(`${CHANNEL}:status`, { detail: serialized }));
  }
  class BitReader {
    constructor(encoded) {
      this.data = Array.from(encoded, (char) => BASE64.indexOf(char));
      this.block = 0;
      this.bit = 0;
    }
    read(length) {
      const bits = [];
      for (let i = 0; i < length; i++) {
        if (this.block >= this.data.length || this.data[this.block] < 0) return null;
        bits.push(((this.data[this.block] >> this.bit) & 1) === 1);
        this.bit++;
        if (this.bit > 5) { this.bit = 0; this.block++; }
      }
      return bits;
    }
    readInt(length) {
      const bits = this.read(length);
      if (!bits) return null;
      return bits.reduce((sum, bit, index) => sum + (bit ? 1 << index : 0), 0);
    }
  }
  class BitWriter {
    constructor() { this.data = []; this.block = 0; this.bit = 0; }
    write(bits) {
      bits.forEach((value) => {
        while (this.data.length <= this.block) this.data.push(0);
        if (value) this.data[this.block] |= 1 << this.bit;
        this.bit++;
        if (this.bit > 5) { this.bit = 0; this.block++; }
      });
    }
    writeInt(value, length) { for (let i = 0; i < length; i++) this.write([((value >> i) & 1) === 1]); }
    toString() { return this.data.map((value) => BASE64[value]).join(""); }
  }

  const MASK_64 = (1n << 64n) - 1n;
  const PCG_MULTIPLIER = 6364136223846793005n;
  const PCG_DEFAULT_INC = 1442695040888963407n;
  const PCG_STREAM_INC = ((PCG_DEFAULT_INC << 1n) | 1n) & MASK_64;

  function hex64(value) { return `0x${(value & MASK_64).toString(16).padStart(16, "0")}`; }
  function parseUint64(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text)) throw new Error("Use a 64-bit decimal or 0x hexadecimal value");
    const parsed = BigInt(text);
    if (parsed < 0n || parsed > MASK_64) throw new Error("Value must fit in an unsigned 64-bit integer");
    return parsed;
  }
  function pcgAdvance(state, inc = PCG_STREAM_INC) { return (state * PCG_MULTIPLIER + inc) & MASK_64; }
  function pcgOutput(state) {
    const shifted = Number((((state >> 18n) ^ state) >> 27n) & 0xffffffffn) >>> 0;
    const rotation = Number((state >> 59n) & 31n);
    return ((shifted >>> rotation) | (shifted << ((-rotation) & 31))) >>> 0;
  }
  function previewRandf(state, inc) {
    const exponentBits = pcgOutput(state);
    if (exponentBits === 0) return 0;
    const nextState = pcgAdvance(state, inc);
    const significand = (pcgOutput(nextState) | 0x80000001) >>> 0;
    return Math.fround(Math.fround(significand) * (2 ** (-32 - Math.clz32(exponentBits))));
  }
  function encodePayload(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function decodePayload(encoded) {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function statesToRuns(states) {
    const runs = [];
    let previous = null;
    for (let frame = 0; frame < states.length; frame++) {
      const state = states[frame] || null;
      if (state && state !== previous) runs.push([frame, state]);
      previous = state || previous;
    }
    return runs;
  }

  class GodotRng {
    constructor() {
      this.address = null;
      this.reason = "waiting for Godot WASM";
      this.candidateCount = 0;
      this.lastScan = -Infinity;
    }
    heap() {
      const runtime = window.iwpcEngine && window.iwpcEngine.rtenv;
      return runtime && runtime.HEAPU32 instanceof Uint32Array ? runtime.HEAPU32 : null;
    }
    read64(word) {
      const heap = this.heap();
      if (!heap || word < 0 || word + 1 >= heap.length) throw new Error("Godot WASM memory is unavailable");
      return (BigInt(heap[word + 1]) << 32n) | BigInt(heap[word]);
    }
    write64(word, value) {
      const heap = this.heap();
      if (!heap || word < 0 || word + 1 >= heap.length) throw new Error("Godot WASM memory is unavailable");
      const normalized = value & MASK_64;
      heap[word] = Number(normalized & 0xffffffffn);
      heap[word + 1] = Number((normalized >> 32n) & 0xffffffffn);
    }
    isValid() {
      if (this.address === null) return false;
      const base = this.address >>> 2;
      try { return this.read64(base + 2) === PCG_STREAM_INC && this.read64(base + 6) === PCG_DEFAULT_INC; }
      catch (_) { return false; }
    }
    ensure(force = false) {
      if (this.isValid()) return true;
      this.address = null;
      const now = nativeNow();
      if (!force && now - this.lastScan < 1000) return false;
      this.lastScan = now;
      const heap = this.heap();
      if (!heap) { this.reason = "waiting for Godot WASM"; return false; }
      const streamLow = Number(PCG_STREAM_INC & 0xffffffffn);
      const streamHigh = Number((PCG_STREAM_INC >> 32n) & 0xffffffffn);
      const defaultLow = Number(PCG_DEFAULT_INC & 0xffffffffn);
      const defaultHigh = Number((PCG_DEFAULT_INC >> 32n) & 0xffffffffn);
      const candidates = [];
      let word = -1;
      while ((word = heap.indexOf(streamLow, word + 1)) >= 0) {
        if ((word & 1) === 0 && word >= 2 && heap[word + 1] === streamHigh && heap[word + 4] === defaultLow && heap[word + 5] === defaultHigh) {
          candidates.push((word - 2) * 4);
        }
      }
      this.candidateCount = candidates.length;
      if (candidates.length !== 1) {
        this.reason = candidates.length ? `ambiguous (${candidates.length} PCG states)` : "Godot global PCG not found";
        return false;
      }
      this.address = candidates[0];
      this.reason = "ready";
      return true;
    }
    snapshot() {
      if (!this.ensure()) return null;
      const base = this.address >>> 2;
      return {
        state: hex64(this.read64(base)),
        inc: hex64(this.read64(base + 2)),
        seed: hex64(this.read64(base + 4)),
        currentInc: hex64(this.read64(base + 6))
      };
    }
    setState(value) {
      if (!this.ensure(true)) throw new Error(this.reason);
      this.write64((this.address >>> 2), parseUint64(value));
      return this.snapshot();
    }
    setSeed(value) {
      if (!this.ensure(true)) throw new Error(this.reason);
      const seed = parseUint64(value);
      const base = this.address >>> 2;
      const currentInc = this.read64(base + 6);
      const streamInc = ((currentInc << 1n) | 1n) & MASK_64;
      const seededState = pcgAdvance((streamInc + seed) & MASK_64, streamInc);
      this.write64(base + 2, streamInc);
      this.write64(base + 4, seed);
      this.write64(base, seededState);
      return this.snapshot();
    }
    restoreState(value) {
      if (!this.ensure()) return false;
      this.write64((this.address >>> 2), parseUint64(value));
      return true;
    }
    getStatus() {
      const snapshot = this.snapshot();
      if (!snapshot) return { detected: false, reason: this.reason, candidates: this.candidateCount };
      const state = parseUint64(snapshot.state);
      const inc = parseUint64(snapshot.inc);
      return Object.assign({
        detected: true,
        reason: this.reason,
        address: `0x${this.address.toString(16)}`,
        nextRandf: previewRandf(state, inc).toPrecision(9)
      }, snapshot);
    }
  }
  class Video {
    constructor(encoded) {
      this.actions = [];
      this.mouseActions = [];
      this.pauseFrame = 0;
      this.initialDirection = 0;
      this.rngRuns = [];
      if (!encoded) return;
      const reader = new BitReader(encoded);
      const size = reader.readInt(12);
      this.initialDirection = reader.readInt(12);
      this.pauseFrame = reader.readInt(24);
      if (size === null || this.initialDirection === null || this.pauseFrame === null) throw new Error("Invalid video string");
      let frame = 0;
      for (let i = 0; i < size; i++) {
        const longDelay = reader.read(1);
        if (!longDelay) throw new Error("Invalid video string");
        const delay = reader.readInt(longDelay[0] ? 10 : 5);
        const code = reader.readInt(3);
        const down = reader.read(1);
        if (delay === null || code === null || !down) throw new Error("Invalid video string");
        frame += delay;
        this.actions.push({ frame, code, down: down[0] });
      }
    }
    copy() {
      const video = new Video();
      video.actions = this.actions.map((action) => Object.assign({}, action));
      video.mouseActions = this.mouseActions.map((action) => Object.assign({}, action));
      video.pauseFrame = this.pauseFrame;
      video.initialDirection = this.initialDirection;
      video.rngRuns = this.rngRuns.map((run) => run.slice());
      return video;
    }
    toString() {
      const writer = new BitWriter();
      writer.writeInt(this.actions.length, 12);
      writer.writeInt(this.initialDirection, 12);
      writer.writeInt(this.pauseFrame, 24);
      let lastFrame = 0;
      this.actions.forEach((action) => {
        const delay = action.frame - lastFrame;
        lastFrame = action.frame;
        const longDelay = delay >= 32;
        writer.write([longDelay]);
        writer.writeInt(delay, longDelay ? 10 : 5);
        writer.writeInt(action.code, 3);
        writer.write([action.down]);
      });
      return writer.toString();
    }
  }
  class VideoPlayer {
    constructor(video) { this.sourceVideo = video.copy(); this.video = video.copy(); this.rngRun = -1; }
    getActions(frame) {
      const result = [];
      while (this.video.actions.length && this.video.actions[0].frame === frame) {
        const action = this.video.actions.shift();
        const codes = gameKeyCodes();
        result.push({ code: codes[action.code] || 0, down: action.down });
      }
      return result;
    }
    getRngState(frame) {
      while (this.rngRun + 1 < this.video.rngRuns.length && this.video.rngRuns[this.rngRun + 1][0] <= frame) this.rngRun++;
      return this.rngRun >= 0 ? this.video.rngRuns[this.rngRun][1] : null;
    }
    getMouseActions(frame) {
      const result = [];
      while (this.video.mouseActions.length && this.video.mouseActions[0].frame === frame) result.push(this.video.mouseActions.shift());
      return result;
    }
  }

  rng = new GodotRng();
  recorder = {
    keyStates: new Array(ACTION_CODES.length).fill(false),
    physicalStates: new Array(ACTION_CODES.length).fill(false),
    pendingTransitions: ACTION_CODES.map(() => []),
    frameStates: new Array(ACTION_CODES.length).fill("Neutral"),
    video: new Video(),
    rngStates: [],
    rngRecordedFrames: 0,
    mouseActions: [],
    pendingMouseActions: [],
    pendingTaps: new Array(ACTION_CODES.length).fill(false)
  };

  function parseTas(encoded) {
    const source = String(encoded || "").trim();
    if (!source.startsWith("CB2:")) return remapVideoActions(new Video(source), LEGACY_ACTION_CODES);
    const payload = decodePayload(source.slice(4));
    if (!payload || ![2, 3].includes(payload.version)) throw new Error("Unsupported CoffeeBean TAS data");
    let video;
    let layout = Array.isArray(payload.inputLayout) ? payload.inputLayout : LEGACY_ACTION_CODES;
    if (payload.video && Array.isArray(payload.video.actions)) {
      video = new Video();
      video.pauseFrame = Number(payload.video.pauseFrame) || 0;
      video.initialDirection = Number(payload.video.initialDirection) || 0;
      video.actions = payload.video.actions.map((action) => ({ frame: Number(action.frame), code: Number(action.code), down: !!action.down }));
      video.mouseActions = Array.isArray(payload.video.mouseActions) ? payload.video.mouseActions.map((action) => ({
        frame: Number(action.frame),
        type: action.type === "mouseup" ? "mouseup" : (action.type === "mousemove" ? "mousemove" : "mousedown"),
        x: Math.min(1, Math.max(0, Number(action.x) || 0)),
        y: Math.min(1, Math.max(0, Number(action.y) || 0)),
        button: Number(action.button) || 0,
        buttons: Number(action.buttons) || 0
      })) : [];
    } else if (typeof payload.input === "string") {
      video = new Video(payload.input);
    } else {
      throw new Error("CoffeeBean TAS input data is missing");
    }
    video = remapVideoActions(video, layout);
    if (payload.rng && Array.isArray(payload.rng.runs)) {
      video.rngRuns = payload.rng.runs.map((run) => [Number(run[0]), hex64(parseUint64(run[1]))]);
    }
    return video;
  }
  function remapVideoActions(video, layout) {
    const normalizedLayout = layout.map((action) => action === "space" ? "jump" : action);
    video.actions = video.actions.flatMap((action) => {
      const name = normalizedLayout[action.code];
      const code = ACTION_CODES.indexOf(name);
      return code < 0 ? [] : [{ frame: action.frame, code, down: action.down }];
    });
    return video;
  }
  function exportTas() {
    const video = recorder.video.copy();
    video.pauseFrame = control.frame;
    video.rngRuns = statesToRuns(recorder.rngStates);
    return `CB2:${encodePayload({
      version: 3,
      inputLayout: ACTION_CODES,
      input: video.toString(),
       video: { actions: video.actions, mouseActions: video.mouseActions, pauseFrame: video.pauseFrame, initialDirection: video.initialDirection },
      rng: { algorithm: "pcg32", runs: video.rngRuns }
    })}`;
  }

  function recordKey(frame, code, down, silent, capture) {
    const codes = gameKeyCodes();
    const action = codes.indexOf(code);
    if (action < 0 || recorder.keyStates[action] === down) return;
    recorder.keyStates[action] = down;
    if (capture) recorder.video.actions.push({ frame, code: action, down });
    if (!silent) console.debug(`[CoffeeBean] ${ACTION_CODES[action]} ${down ? "down" : "up"} @ ${frame}`);
  }
  function canvasForInput() {
    return document.querySelector("canvas");
  }
  function mousePosition(event, canvas) {
    const rect = canvas && typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    return {
      x: Math.min(1, Math.max(0, (Number(event.clientX) - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (Number(event.clientY) - rect.top) / Math.max(1, rect.height)))
    };
  }
  function queueMouseAction(event, type) {
    const canvas = canvasForInput();
    if (!canvas) return;
    const position = mousePosition(event, canvas);
    recorder.pendingMouseActions.push({ frame: control.frame, type, x: position.x, y: position.y, button: Number(event.button) || 0, buttons: Number(event.buttons) || 0 });
  }
  function recordMouseAction(action, silent, capture) {
    if (capture) recorder.video.mouseActions.push(Object.assign({}, action));
    if (!silent) console.debug(`[CoffeeBean] ${action.type} @ ${action.frame}`);
  }
  function dispatchMouseAction(action) {
    const canvas = canvasForInput();
    if (!canvas || typeof canvas.dispatchEvent !== "function") return;
    const rect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: canvas.width || 1, height: canvas.height || 1 };
    const event = new MouseEvent(action.type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + action.x * Math.max(1, rect.width),
      clientY: rect.top + action.y * Math.max(1, rect.height),
      button: action.button,
      buttons: action.buttons
    });
    syntheticPointerEvents.add(event);
    canvas.dispatchEvent(event);
  }
  function dispatchSyntheticKey(code, down) {
    const action = gameKeyCodes().indexOf(code);
    const eventCode = action >= 0 ? config.gameKeys[ACTION_CODES[action]] : keyCodeToCode(code);
    const keyNames = { ArrowLeft: "ArrowLeft", ArrowUp: "ArrowUp", ArrowRight: "ArrowRight", ArrowDown: "ArrowDown", Space: " ", Enter: "Enter", Escape: "Escape" };
    const event = new KeyboardEvent(down ? "keydown" : "keyup", {
      bubbles: true,
      cancelable: true,
      code: eventCode,
      key: keyNames[eventCode] || (eventCode.startsWith("Key") ? eventCode.slice(3).toLowerCase() : eventCode),
      repeat: false
    });
    syntheticEvents.add(event);
    try {
      Object.defineProperty(event, "keyCode", { value: code });
      Object.defineProperty(event, "which", { value: code });
    } catch (_) {}
    const active = document.activeElement;
    const target = active instanceof HTMLCanvasElement ? active : (document.querySelector("canvas") || document.body || window);
    target.dispatchEvent(event);
  }
  function sendGameInput(code, down, silent = false, capture = true) {
    recordKey(control.frame, code, down, silent, capture);
    const event = { which: code, keyCode: code, code: keyCodeToCode(code), preventDefault() {} };
    if (down && keydownHandler) keydownHandler(event);
    else if (!down && keyupHandler) keyupHandler(event);
    else dispatchSyntheticKey(code, down);
  }
  function queueGameInput(code, down) {
    const action = gameKeyCodes().indexOf(code);
    if (action < 0 || recorder.physicalStates[action] === down) return;
    recorder.physicalStates[action] = down;
    recorder.pendingTransitions[action].push(down);
  }
  function queueTap(actionName) {
    const action = ACTION_CODES.indexOf(String(actionName || "").toLowerCase());
    if (action < 0) throw new Error(`Unknown tap input: ${actionName}`);
    // A tap is an explicit workspace command. Keyboard transitions are
    // reduced to their final state and never become taps implicitly.
    if (playback || recorder.keyStates[action] || recorder.physicalStates[action]) return false;
    recorder.pendingTransitions[action].length = 0;
    recorder.pendingTaps[action] = true;
    emitStatus();
    return true;
  }
  function nextInputState(action) {
    if (recorder.pendingTaps[action]) return "Tap";
    const transitions = recorder.pendingTransitions[action];
    if (transitions.length === 1) return transitions[0] ? "Press" : "Release";
    if (transitions.length > 1) return transitions[transitions.length - 1] ? "Press" : "Release";
    return recorder.keyStates[action] ? "Held" : "Neutral";
  }
  function beginInputFrame() {
    recorder.frameStates = recorder.keyStates.map((held) => held ? "Held" : "Neutral");
  }
  function applyQueuedInputFrame() {
    beginInputFrame();
    const codes = gameKeyCodes();
    recorder.pendingTransitions.forEach((transitions, action) => {
      if (recorder.pendingTaps[action]) {
        sendGameInput(codes[action], true, false, true);
        sendGameInput(codes[action], false, false, true);
        recorder.frameStates[action] = "Tapped";
        recorder.pendingTaps[action] = false;
      } else if (transitions.length > 0) {
        // Collapse multiple keyboard events in one frame to the final
        // physical state. Only an explicit workspace tap emits both edges.
        const down = transitions[transitions.length - 1];
        if (recorder.keyStates[action] !== down) {
          sendGameInput(codes[action], down, false, true);
          recorder.frameStates[action] = down ? "Pressed" : "Released";
        }
      }
      transitions.length = 0;
    });
  }
  function applyQueuedMouseFrame() {
    const actions = recorder.pendingMouseActions.splice(0);
    actions.forEach((action) => {
      recordMouseAction(action, true, true);
      dispatchMouseAction(action);
    });
  }
  function resetInputTracking() {
    recorder.keyStates.fill(false);
    recorder.physicalStates.fill(false);
    recorder.pendingTransitions.forEach((transitions) => { transitions.length = 0; });
    recorder.pendingTaps.fill(false);
    recorder.frameStates.fill("Neutral");
    recorder.pendingMouseActions.length = 0;
    mouseButtons.clear();
  }
  function primeControls() {
    gameKeyCodes().forEach((code) => sendGameInput(code, false, true, false));
    resetInputTracking();
    if (initialDirection === 1) {
      recorder.physicalStates[0] = true;
      sendGameInput(gameKeyCodes()[0], true, true, false);
    }
    if (initialDirection === 2) {
      recorder.physicalStates[1] = true;
      sendGameInput(gameKeyCodes()[1], true, true, false);
    }
  }
  function cancelPlayback(reason = "Playback was cancelled") {
    const session = playbackSession;
    playback = null;
    playbackSession = null;
    if (!session) return;
    if (session.busy) stateBusy = false;
    if (session.reject) session.reject(reason instanceof Error ? reason : new Error(String(reason)));
  }
  function takeoverPlayback() {
    if (!playback) throw new Error("No playback is active");
    if (!control.paused) throw new Error("Pause playback before switching to recording");
    const session = playbackSession;
    const video = playback.sourceVideo.copy();
    video.actions = video.actions.filter((action) => action.frame < control.frame);
    video.mouseActions = video.mouseActions.filter((action) => action.frame < control.frame);
    video.pauseFrame = control.frame;
    const rngStates = checkpointRngStates(video);
    video.rngRuns = statesToRuns(rngStates);
    playback = null;
    playbackSession = null;
    recorder.video = video;
    recorder.rngStates = rngStates;
    recorder.rngRecordedFrames = rngStates.filter(Boolean).length;
    recorder.physicalStates = recorder.keyStates.slice();
    recorder.pendingTransitions = ACTION_CODES.map(() => []);
    recorder.pendingTaps.fill(false);
    recorder.pendingMouseActions.length = 0;
    recorder.frameStates = recorder.keyStates.map((held) => held ? "Held" : "Neutral");
    mouseButtons.clear();
    stateBusy = false;
    rerecords++;
    control.paused = true;
    control.speed = 0;
    stepBudget = 0;
    nextFrameDeadline = null;
    resetFrameRateMeasurement();
    const result = { frame: control.frame, targetFrame: session ? session.targetFrame : video.pauseFrame, playing: false, takeover: true, rerecords };
    if (session && session.resolve) session.resolve(result);
    emitStatus();
    return result;
  }
  function resetRecordingState(pauseAfter) {
    cancelPlayback("Playback was cancelled by reset");
    resetInputTracking();
    recorder.video = new Video();
    recorder.video.initialDirection = initialDirection;
    recorder.rngStates = [];
    recorder.rngRecordedFrames = 0;
    control = { frame: 0, paused: !!pauseAfter, speed: control.speed };
    nextFrameDeadline = null;
    resetFrameRateMeasurement();
    recordingStartTime = fakeTime;
    primeControls();
    stepBudget = 0;
    emitStatus();
  }
  function resetLevel(pauseAfter) {
    sendGameInput(82, true, true, false);
    sendGameInput(82, false, true, false);
    resetRecordingState(pauseAfter);
  }
  function requestGameReload(pending) {
    const detail = { fullReload: false };
    try {
      if (pending && window.sessionStorage) {
        window.sessionStorage.setItem(PENDING_RELOAD_KEY, JSON.stringify(pending));
        detail.fullReload = true;
      }
    } catch (_) {
      detail.fullReload = false;
    }
    const event = new CustomEvent(`${CHANNEL}:game-reload-request`, { cancelable: true, detail });
    const handled = !document.dispatchEvent(event);
    if (detail.promise && typeof detail.promise.then === "function") return Promise.resolve(detail.promise);
    if (handled && detail.fullReload) return new Promise(() => {});
    try { if (window.sessionStorage) window.sessionStorage.removeItem(PENDING_RELOAD_KEY); } catch (_) {}
    sendGameInput(82, true, true, false);
    sendGameInput(82, false, true, false);
    return Promise.resolve(false);
  }
  function beginRecording() {
    if (pendingReloadPlayback) {
      const pending = pendingReloadPlayback;
      pendingReloadPlayback = null;
      try {
        restoreReloadPlayback(pending);
        return;
      } catch (error) {
        console.error("[CoffeeBean] pending checkpoint recovery failed", error);
      }
    }
    resetInputTracking();
    recorder.video = new Video();
    recorder.video.initialDirection = initialDirection;
    recorder.rngStates = [];
    recorder.rngRecordedFrames = 0;
    cancelPlayback("Playback was cancelled by a new recording");
    control.frame = 0;
    recordingStartTime = fakeTime;
    control.paused = true;
    control.speed = 0;
    stepBudget = 0;
    emitStatus();
  }
  function normalizeSlot(value) {
    const slot = Number(value);
    if (!Number.isInteger(slot) || slot < 0 || slot >= stateSlots.length) throw new Error(`Savestate slot must be 0-${stateSlots.length - 1}`);
    return slot;
  }
  function checkpointRngStates(video) {
    const states = new Array(Math.max(0, video.pauseFrame));
    let run = -1;
    for (let frame = 0; frame < states.length; frame++) {
      while (run + 1 < video.rngRuns.length && video.rngRuns[run + 1][0] <= frame) run++;
      if (run >= 0) states[frame] = video.rngRuns[run][1];
    }
    return states;
  }
  function checkpointKeyStates(video) {
    const states = new Array(ACTION_CODES.length).fill(false);
    for (const action of video.actions) {
      if (action.frame >= video.pauseFrame || action.code < 0 || action.code >= states.length) continue;
      states[action.code] = !!action.down;
    }
    return states;
  }
  function normalizeCheckpoint(saved) {
    const video = deserializeVideo(saved && saved.video || {});
    const frame = Math.max(0, Number(saved && saved.frame) || video.pauseFrame || 0);
    video.pauseFrame = frame;
    video.actions = video.actions.filter((action) => action.frame < frame);
    video.mouseActions = video.mouseActions.filter((action) => action.frame < frame);
    let rngStates = Array.isArray(saved && saved.rngStates) ? saved.rngStates.slice(0, frame) : checkpointRngStates(video);
    if (!video.rngRuns.length) video.rngRuns = statesToRuns(rngStates);
    const keyStates = Array.isArray(saved && saved.keyStates)
      ? ACTION_CODES.map((_, index) => !!saved.keyStates[index])
      : checkpointKeyStates(video);
    return {
      frame,
      frameRate: PROJECT_FRAME_RATE,
      startTime: Number.isFinite(Number(saved && saved.startTime))
        ? Number(saved.startTime)
        : (Number.isFinite(Number(saved && saved.fakeTime)) ? Number(saved.fakeTime) - frame * (1000 / normalizeFrameRate(saved && saved.frameRate)) : fakeTime),
      initialDirection: Number(saved && saved.initialDirection) || video.initialDirection || 0,
      video,
      rngStates,
      rngRecordedFrames: Number(saved && saved.rngRecordedFrames) || rngStates.filter(Boolean).length,
      keyStates,
      physicalStates: Array.isArray(saved && saved.physicalStates) ? ACTION_CODES.map((_, index) => !!saved.physicalStates[index]) : keyStates.slice(),
      rerecords: Number(saved && saved.rerecords) || 0
    };
  }
  function serializeStateSlot(slot) {
    if (!slot) return null;
    return {
      frame: slot.frame,
      frameRate: slot.frameRate,
      startTime: slot.startTime,
      initialDirection: slot.initialDirection,
      video: serializeVideo(slot.video),
      rngStates: slot.rngStates,
      rngRecordedFrames: slot.rngRecordedFrames,
      keyStates: slot.keyStates,
      physicalStates: slot.physicalStates,
      rerecords: slot.rerecords
    };
  }
  async function saveState(slotValue = 0) {
    const slot = normalizeSlot(slotValue);
    if (playback) throw new Error("Pause replay before creating a savestate");
    if (stateBusy) throw new Error("Another savestate operation is still running");
    stateBusy = true;
    control.paused = true;
    control.speed = 0;
    stepBudget = 0;
    emitStatus();
    try {
      const video = recorder.video.copy();
      video.actions = video.actions.filter((action) => action.frame < control.frame);
      video.mouseActions = video.mouseActions.filter((action) => action.frame < control.frame);
      video.pauseFrame = control.frame;
      const rngStates = recorder.rngStates.slice(0, control.frame);
      video.rngRuns = statesToRuns(rngStates);
      stateSlots[slot] = normalizeCheckpoint({
        frame: control.frame,
        frameRate: PROJECT_FRAME_RATE,
        startTime: recordingStartTime,
        initialDirection,
        video,
        rngStates,
        rngRecordedFrames: rngStates.filter(Boolean).length,
        keyStates: recorder.keyStates.slice(),
        physicalStates: recorder.physicalStates.slice(),
        rerecords
      });
      return { slot, frame: control.frame, actions: video.actions.length, rngFrames: stateSlots[slot].rngRecordedFrames, rerecords };
    } finally {
      stateBusy = false;
      emitStatus();
    }
  }
  function finishCheckpointPlayback() {
    const session = playbackSession;
    if (!session) return;
    const saved = session.saved;
    playback = null;
    playbackSession = null;
    recorder.video = saved.video.copy();
    recorder.rngStates = saved.rngStates.slice();
    recorder.rngRecordedFrames = saved.rngRecordedFrames;
    recorder.keyStates = saved.keyStates.slice();
    // The checkpoint's logical held state is the new input baseline. Do not
    // synthesize a release to reconcile it with keys from before the iframe
    // reload; only a later physical transition may change it.
    recorder.physicalStates = saved.keyStates.slice();
    recorder.pendingTransitions = ACTION_CODES.map(() => []);
    recorder.frameStates = saved.keyStates.map((held) => held ? "Held" : "Neutral");
    if (session.countRerecord) rerecords++;
    if (session.mode === "play") {
      control.paused = false;
      control.speed = 1;
      nextFrameDeadline = nativeNow();
    } else {
      control.paused = true;
      control.speed = 0;
      nextFrameDeadline = null;
      stepBudget = 0;
    }
    resetFrameRateMeasurement();
    if (session.busy) stateBusy = false;
    const result = { slot: session.slot, frame: saved.frame, targetFrame: saved.frame, playing: session.mode === "play", rerecords };
    if (session.resolve) session.resolve(result);
    emitStatus();
  }
  function initializeCheckpointPlayback(saved, mode, slot, hostStates, resumeSpeed, options = {}) {
    frameRate = PROJECT_FRAME_RATE;
    frameLength = 1000 / frameRate;
    config.frameRate = frameRate;
    // A fresh iframe already has its own monotonic clock. Reusing the old
    // document's absolute startTime would make Godot observe a time jump.
    recordingStartTime = fakeTime - saved.frame * frameLength;
    const replayVideo = saved.video.copy();
    replayVideo.pauseFrame = saved.frame;
    replayVideo.rngRuns = statesToRuns(saved.rngStates);
    playback = new VideoPlayer(replayVideo);
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    playbackSession = {
      mode,
      slot,
      targetFrame: saved.frame,
      saved,
      hostStates,
      resumeSpeed,
      replaySpeed: "normal",
      busy: options.busy !== false,
      countRerecord: options.countRerecord !== false,
      resolve: resolveCompletion,
      reject: rejectCompletion
    };
    stateBusy = playbackSession.busy;
    if (saved.frame === 0) {
      // The workspace waits for an explicit playback status before accepting
      // the terminal paused status. This matters for empty TAS projects: frame
      // zero completes synchronously, so without this signal Open Project waits
      // forever even though the new iframe restored successfully.
      emitStatus();
      finishCheckpointPlayback();
    }
    else {
      control.paused = false;
      control.speed = 1;
      nextFrameDeadline = nativeNow();
      resumePaused();
      emitStatus();
    }
    return completion;
  }
  function restoreReloadPlayback(pending) {
    if (!pending || pending.version !== 1 || !pending.saved) throw new Error("Invalid pending checkpoint reload");
    if (pending.config) normalizeConfig(pending.config);
    stateSlots = new Array(8).fill(null);
    (pending.stateSlots || []).slice(0, 8).forEach((slot, index) => {
      stateSlots[index] = slot ? deserializeStateSlot(slot) : null;
    });
    rerecords = Number(pending.rerecords) || 0;
    const saved = deserializeStateSlot(pending.saved);
    initialDirection = saved.initialDirection;
    resetRecordingState(true);
    const hostStates = Array.isArray(pending.hostStates)
      ? ACTION_CODES.map((_, index) => !!pending.hostStates[index])
      : new Array(ACTION_CODES.length).fill(false);
    const resumeSpeed = "normal";
    void initializeCheckpointPlayback(saved, pending.mode === "play" ? "play" : "load", Number(pending.slot), hostStates, resumeSpeed)
      .catch((error) => console.error("[CoffeeBean] restored checkpoint playback failed", error));
  }
  async function startCheckpointPlayback(source, mode, slot, options = {}) {
    if (stateBusy) throw new Error("Another savestate operation is still running");
    const saved = normalizeCheckpoint(source);
    const hostStates = recorder.physicalStates.slice();
    const resumeSpeed = playbackSpeed;
    stateBusy = true;
    initialDirection = saved.initialDirection;
    cancelPlayback("Playback was replaced by a checkpoint load");
    emitStatus();
    try {
      await requestGameReload({
        version: 1,
        mode,
        slot,
        saved: serializeStateSlot(saved),
        stateSlots: stateSlots.map(serializeStateSlot),
        hostStates,
        resumeSpeed,
        config,
        rerecords
      });
    } catch (error) {
      control.paused = true;
      control.speed = 0;
      stepBudget = 0;
      stateBusy = false;
      emitStatus();
      throw error;
    }
    resetRecordingState(true);
    return initializeCheckpointPlayback(saved, mode, slot, hostStates, resumeSpeed, options);
  }
  function loadState(slotValue = 0) {
    if (stateBusy) throw new Error("Another savestate operation is still running");
    const slot = normalizeSlot(slotValue);
    const saved = stateSlots[slot];
    if (!saved) throw new Error(`Savestate slot ${slot + 1} is empty`);
    return startCheckpointPlayback(saved, "load", slot);
  }
  function playState(slotValue = 0) {
    const slot = normalizeSlot(slotValue);
    const saved = stateSlots[slot];
    if (!saved) throw new Error(`Savestate slot ${slot + 1} is empty`);
    return startCheckpointPlayback(saved, "play", slot);
  }
  function serializeVideo(video) {
    return { actions: video.actions, mouseActions: video.mouseActions, pauseFrame: video.pauseFrame, initialDirection: video.initialDirection, rngRuns: video.rngRuns };
  }
  function deserializeVideo(data) {
    const video = new Video();
    video.actions = Array.isArray(data.actions) ? data.actions.map((action) => ({ frame: Number(action.frame), code: Number(action.code), down: !!action.down })) : [];
    video.mouseActions = Array.isArray(data.mouseActions) ? data.mouseActions.map((action) => ({
      frame: Number(action.frame),
      type: action.type === "mouseup" ? "mouseup" : (action.type === "mousemove" ? "mousemove" : "mousedown"),
      x: Math.min(1, Math.max(0, Number(action.x) || 0)),
      y: Math.min(1, Math.max(0, Number(action.y) || 0)),
      button: Number(action.button) || 0,
      buttons: Number(action.buttons) || 0
    })) : [];
    video.pauseFrame = Number(data.pauseFrame) || 0;
    video.initialDirection = Number(data.initialDirection) || 0;
    video.rngRuns = Array.isArray(data.rngRuns) ? data.rngRuns.map((run) => [Number(run[0]), String(run[1])]) : [];
    return video;
  }
  function deserializeStateSlot(slot) { return slot ? normalizeCheckpoint(slot) : null; }
  function deserializeBinaryStateSlot(slot, binaryBlob, cursor) {
    if (!slot) return null;
    for (const page of slot.pages || []) {
      const byteLength = Number(page.byteLength);
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || cursor.offset + byteLength > binaryBlob.size) throw new Error("Invalid .cbproj savestate page");
      cursor.offset += byteLength;
    }
    return normalizeCheckpoint(slot);
  }
  async function gzipParts(parts) {
    if (typeof CompressionStream !== "function" || typeof ReadableStream !== "function") return new Blob(parts);
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index >= parts.length) { controller.close(); return; }
        controller.enqueue(parts[index++]);
      }
    });
    return new Response(stream.pipeThrough(new CompressionStream("gzip"))).blob();
  }
  async function gunzipBlob(source) {
    const blob = source instanceof Blob ? source : new Blob([source]);
    const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (signature[0] !== 0x1f || signature[1] !== 0x8b) return blob;
    if (typeof DecompressionStream !== "function") throw new Error("This browser cannot decompress .cbproj files");
    return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  }
  async function exportProject() {
    if (stateBusy) throw new Error("Wait for the savestate operation to finish");
    const project = {
      format: "CoffeeBeanProject",
      version: 3,
      game: "iwpc-godot-4.4.1",
      createdAt: new Date().toISOString(),
      frameRate: PROJECT_FRAME_RATE,
      frameLength,
      config,
      rerecords,
      tas: exportTas(),
      savestates: stateSlots.map(serializeStateSlot)
    };
    const metadata = new TextEncoder().encode(JSON.stringify(project));
    const header = new Uint8Array(PROJECT_MAGIC.length + 4);
    header.set(PROJECT_MAGIC);
    new DataView(header.buffer).setUint32(PROJECT_MAGIC.length, metadata.length, true);
    const compressed = await gzipParts([header, metadata]);
    return compressed.slice(0, compressed.size, "application/x-coffeebean-project");
  }
  async function downloadProject(filename) {
    const summary = {
      frame: control.frame,
      savestates: stateSlots.filter(Boolean).length,
      actions: recorder.video.actions.filter((action) => action.frame < control.frame).length,
      mouseActions: recorder.video.mouseActions.filter((action) => action.frame < control.frame).length,
      rngFrames: recorder.rngStates.slice(0, control.frame).filter(Boolean).length
    };
    if (summary.frame === 0 && summary.savestates === 0 && summary.actions === 0 && summary.mouseActions === 0 && summary.rngFrames === 0) {
      throw new Error("Project is empty. Advance the TAS or create a savestate before saving.");
    }
    const blob = await exportProject();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `iwpc-${new Date().toISOString().replace(/[:.]/g, "-")}.cbproj`;
    const downloadFilename = link.download;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    return Object.assign({ bytes: blob.size, filename: downloadFilename }, summary);
  }
  async function importProject(source) {
    if (stateBusy) throw new Error("Wait for the savestate operation to finish");
    const unpacked = await gunzipBlob(source);
    const header = new Uint8Array(await unpacked.slice(0, PROJECT_MAGIC.length + 4).arrayBuffer());
    const isVersion2 = PROJECT_MAGIC.every((value, index) => header[index] === value);
    let project;
    if (isVersion2) {
      const metadataLength = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(PROJECT_MAGIC.length, true);
      const metadataEnd = PROJECT_MAGIC.length + 4 + metadataLength;
      if (metadataEnd > unpacked.size) throw new Error("Invalid .cbproj metadata length");
      project = JSON.parse(new TextDecoder().decode(await unpacked.slice(PROJECT_MAGIC.length + 4, metadataEnd).arrayBuffer()));
      if (!project || project.format !== "CoffeeBeanProject" || ![2, 3].includes(project.version)) throw new Error("Unsupported .cbproj project");
      const binaryBlob = unpacked.slice(metadataEnd);
      const cursor = { offset: 0 };
      const importedFrameRate = normalizeFrameRate(project.frameRate || (Number(project.frameLength) > 0 ? 1000 / Number(project.frameLength) : DEFAULT_CONFIG.frameRate));
      if (project.version === 2 && project.memoryBaseline) {
        const byteLength = Number(project.memoryBaseline.byteLength);
        if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > binaryBlob.size) throw new Error("Invalid .cbproj memory baseline");
        cursor.offset = byteLength;
      }
      stateSlots = new Array(8).fill(null);
      for (let index = 0; index < Math.min(8, (project.savestates || []).length); index++) {
        const rawSlot = project.savestates[index];
        if (!rawSlot) continue;
        const withFrameRate = Object.assign({ frameRate: importedFrameRate }, rawSlot);
        stateSlots[index] = project.version === 2
          ? deserializeBinaryStateSlot(withFrameRate, binaryBlob, cursor)
          : deserializeStateSlot(withFrameRate);
      }
      if (cursor.offset !== binaryBlob.size) throw new Error("Unexpected data at the end of .cbproj project");
    } else {
      const bytes = new Uint8Array(await unpacked.arrayBuffer());
      project = JSON.parse(new TextDecoder().decode(bytes));
      if (!project || project.format !== "CoffeeBeanProject" || project.version !== 1) throw new Error("Unsupported .cbproj project");
      const importedFrameRate = normalizeFrameRate(project.frameRate || (Number(project.frameLength) > 0 ? 1000 / Number(project.frameLength) : DEFAULT_CONFIG.frameRate));
      stateSlots = new Array(8).fill(null);
      (project.savestates || []).slice(0, 8).forEach((slot, index) => {
        stateSlots[index] = slot ? deserializeStateSlot(Object.assign({ frameRate: importedFrameRate }, slot)) : null;
      });
    }
    if (project.config) configure(project.config);
    if (project.frameRate || Number(project.frameLength) > 0) setFrameRate(project.frameRate || 1000 / Number(project.frameLength), false);
    rerecords = Number(project.rerecords) || 0;
    const firstState = stateSlots.findIndex(Boolean);
    if (firstState >= 0) await loadState(firstState);
    else {
      await loadVideo(project.tas);
    }
    emitStatus();
    return { frame: control.frame, savestates: stateSlots.filter(Boolean).length, rerecords };
  }
  function resumePaused() {
    const callback = pausedCallback;
    pausedCallback = null;
    stepBudget = 0;
    nextFrameDeadline = control.speed === 1 ? nativeNow() : null;
    resetFrameRateMeasurement();
    if (callback) window.setTimeout(() => callback(fakeTime), 0);
    else if (lastRafCallback && !rafPending) window.setTimeout(() => lastRafCallback(), 0);
  }
  function pumpStep() {
    if (!control.paused || stepBudget < 1 || pumpingStep) return;
    if (!pausedCallback) {
      if (!lastRafCallback || rafPending) return;
      pausedCallback = lastRafCallback;
    }
    const callback = pausedCallback;
    pausedCallback = null;
    stepBudget--;
    pumpingStep = true;
    window.setTimeout(() => {
      try { callback(fakeTime); }
      finally { pumpingStep = false; pumpStep(); }
    }, 0);
  }
  function queueStep() {
    control.paused = true;
    control.speed = 0;
    nextFrameDeadline = null;
    resetFrameRateMeasurement();
    stepBudget = Math.min(stepBudget + 1, 1000);
    pumpStep();
    emitStatus();
  }
  function setSpeed(speed) {
    playbackSpeed = "normal";
    control.speed = 1;
    control.paused = false;
    resumePaused();
    emitStatus();
  }
  function togglePause() {
    if (control.paused) {
      setSpeed(playbackSpeed);
      return;
    }
    playbackSpeed = control.speed === 0 ? "slow" : (control.speed === 2 ? "fast" : "normal");
    control.paused = true;
    control.speed = 0;
    nextFrameDeadline = null;
    resetFrameRateMeasurement();
    stepBudget = 0;
    emitStatus();
  }
  function requestReset() {
    const event = new CustomEvent(`${CHANNEL}:reset-request`, { cancelable: true });
    if (document.dispatchEvent(event)) resetLevel(true);
  }
  function handleAction(action) {
    switch (action) {
      case "step": queueStep(); break;
      case "pause": togglePause(); break;
      case "play": setSpeed(config.speed); break;
      case "slow": setSpeed("normal"); break;
      case "normal": setSpeed("normal"); break;
      case "fast": setSpeed("normal"); break;
      case "takeover": takeoverPlayback(); break;
      case "reset": requestReset(); break;
      case "reset-confirmed": resetLevel(true); break;
      case "quicksave": void saveState(0).catch((error) => console.error("[CoffeeBean] quicksave failed", error)); break;
      case "quickload": void loadState(0).catch((error) => console.error("[CoffeeBean] quickload failed", error)); break;
      default: break;
    }
  }
  function applyPlaybackFrame() {
    if (!playback) return;
    beginInputFrame();
    playback.getMouseActions(control.frame).forEach(dispatchMouseAction);
    playback.getActions(control.frame).forEach((action) => {
      const actionIndex = gameKeyCodes().indexOf(action.code);
      sendGameInput(action.code, action.down, true, false);
      if (actionIndex >= 0) recorder.frameStates[actionIndex] = action.down ? "Pressed" : "Released";
    });
  }
  function prepareRngFrame() {
    if (!config.rng.enabled || !rng.ensure()) return;
    if (playback && config.rng.playback) {
      const state = playback.getRngState(control.frame);
      if (state) rng.restoreState(state);
    } else if (!playback && config.rng.record) {
      const snapshot = rng.snapshot();
      if (snapshot) {
        if (!recorder.rngStates[control.frame]) recorder.rngRecordedFrames++;
        recorder.rngStates[control.frame] = snapshot.state;
      }
    }
  }
  function normalFrameDelay() {
    const now = nativeNow();
    const stallResetThreshold = Math.max(50, frameLength * 6);
    // Compensate ordinary callback/rendering overhead so the 120 Hz project
    // clock does not slow down. Only a real loading stall drops stale debt.
    if (nextFrameDeadline === null || now - nextFrameDeadline > stallResetThreshold || nextFrameDeadline - now > frameLength * 2) {
      nextFrameDeadline = now;
    }
    nextFrameDeadline += frameLength;
    return Math.max(0, nextFrameDeadline - now);
  }
  function fastFrameDelay() {
    const now = nativeNow();
    const fastFrameLength = frameLength / FAST_SPEED_MULTIPLIER;
    const stallResetThreshold = Math.max(50, fastFrameLength * 6);
    if (nextFrameDeadline === null || now - nextFrameDeadline > stallResetThreshold || nextFrameDeadline - now > fastFrameLength * 2) {
      nextFrameDeadline = now;
    }
    nextFrameDeadline += fastFrameLength;
    return Math.max(0, nextFrameDeadline - now);
  }
  function scheduleFrame(callback, delay) {
    if (delay > 0 || !immediateFrameChannel) return window.setTimeout(callback, Math.max(0, delay));
    immediateFrameQueue.push(callback);
    if (!immediateFrameDraining && immediateFrameQueue.length === 1) immediateFrameChannel.port2.postMessage(0);
    return 0;
  }
  function resetFrameRateMeasurement() {
    measuredFrameRate = 0;
    rateWindowStart = nativeNow();
    rateWindowFrames = 0;
  }
  function countMeasuredFrame() {
    rateWindowFrames += 1;
    const now = nativeNow();
    const elapsed = now - rateWindowStart;
    if (elapsed < 500) return;
    measuredFrameRate = rateWindowFrames * 1000 / elapsed;
    rateWindowStart = now;
    rateWindowFrames = 0;
  }
  function requestAnimationFrame(callback) {
    if (!config.enabled) return nativeRaf(callback);
    const wrapped = (timestamp, forced = false) => {
      rafPending = false;
      if (control.paused && !forced) {
        pausedCallback = () => wrapped(fakeTime, true);
        pumpStep();
        return;
      }
      fakeTime += frameLength;
      prepareRngFrame();
      if (playback) applyPlaybackFrame();
      else {
        applyQueuedMouseFrame();
        applyQueuedInputFrame();
      }
      callback(fakeTime);
      control.frame += 1;
      countMeasuredFrame();
      if (playbackSession && control.frame >= playbackSession.targetFrame) finishCheckpointPlayback();
      else if (playback && control.frame >= playback.video.pauseFrame) {
        playback = null;
        control.paused = true;
        control.speed = 0;
      }
      emitStatus(true);
    };
    lastRafCallback = () => wrapped(fakeTime, true);
    if (control.paused) { nextFrameDeadline = null; pausedCallback = lastRafCallback; pumpStep(); return 0; }
    if (control.speed === 0) { nextFrameDeadline = null; rafPending = true; return window.setTimeout(() => wrapped(fakeTime), 100); }
    if (control.speed === 2) {
      rafPending = true;
      return scheduleFrame(() => wrapped(fakeTime), fastFrameDelay());
    }
    rafPending = true;
    const delay = normalFrameDelay();
    return scheduleFrame(() => wrapped(fakeTime), delay);
  }
  function onKey(event, down) {
    if (syntheticEvents.has(event)) return;
    if (!config.enabled) return;
    const code = codeFromEvent(event);
    const controlAction = Object.keys(config.controls).find((name) => config.controls[name] === code);
    if (controlAction) {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      if (down && (!event.repeat || controlAction === "step")) handleAction(controlAction);
      return;
    }
    const gameCodes = gameKeyCodes();
    if (playback) {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      return;
    }
    if (gameCodes.includes(keyCodeFor(code))) {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      queueGameInput(keyCodeFor(code), down);
      emitStatus();
    }
  }
  const mouseButtons = new Set();
  function onMouse(event, type) {
    if (syntheticPointerEvents.has(event) || !config.enabled) return;
    const canvas = canvasForInput();
    const onCanvas = !!canvas && (event.target === canvas || (type === "mouseup" && mouseButtons.has(Number(event.button) || 0)));
    if (!onCanvas) return;
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    if (type === "mousedown") mouseButtons.add(Number(event.button) || 0);
    if (type === "mouseup") mouseButtons.delete(Number(event.button) || 0);
    if (!playback) queueMouseAction(event, type);
    emitStatus();
  }
  function registerKeydown(callback) { keydownHandler = callback; emitStatus(); }
  function registerKeyup(callback) { keyupHandler = callback; emitStatus(); }
  function onScene(name) {
    if (!fullgameVideo || !fullgameVideo[name]) return;
    playback = new VideoPlayer(new Video(fullgameVideo[name]));
    control.paused = false;
    control.frame = 0;
    control.speed = 1;
    primeControls();
  }
  function loadVideo(encoded) {
    const loaded = parseTas(encoded);
    slots[0] = loaded;
    const rngStates = checkpointRngStates(loaded);
    return startCheckpointPlayback({
      frame: loaded.pauseFrame,
      frameRate,
      startTime: fakeTime,
      initialDirection: loaded.initialDirection,
      video: loaded,
      rngStates,
      rngRecordedFrames: rngStates.filter(Boolean).length,
      keyStates: checkpointKeyStates(loaded),
      physicalStates: checkpointKeyStates(loaded),
      rerecords
    }, "load", -1, { countRerecord: false });
  }
  function configure(next) { normalizeConfig(next); emitStatus(); }
  function setFrameRate(value, shouldEmit = true) {
    frameRate = PROJECT_FRAME_RATE;
    frameLength = 1000 / frameRate;
    config.frameRate = PROJECT_FRAME_RATE;
    nextFrameDeadline = null;
    if (shouldEmit) emitStatus();
    return PROJECT_FRAME_RATE;
  }
  function installTimeHook() {
    const now = () => config.enabled ? fakeTime : nativeNow();
    try {
      Object.defineProperty(nativePerformance, "now", { configurable: true, value: now });
      timePatched = true;
    } catch (_) {
      try {
        const proxy = new Proxy(nativePerformance, { get(target, property) { return property === "now" ? now : Reflect.get(target, property, target); } });
        Object.defineProperty(window, "performance", { configurable: true, get: () => config.enabled ? proxy : nativePerformance });
        timePatched = true;
      } catch (_) { timePatched = false; }
    }
  }
  function installRafHook() {
    try { Object.defineProperty(window, "requestAnimationFrame", { configurable: true, writable: true, value: requestAnimationFrame }); rafPatched = true; }
    catch (_) { rafPatched = false; }
  }
  function shouldSuppressRender() {
    if (!config.enabled || control.paused || control.speed === 0) return false;
    if (control.speed === 2) {
      if (playbackSession && control.frame + 1 >= playbackSession.targetFrame) return false;
      return control.frame % 4 !== 0;
    }
    // At normal speed every logical tick is presented. Suppressing WebGL calls
    // here made both play and replay visibly choppy and changed route timing.
    return false;
  }
  function installRenderHook() {
    const methodNames = ["clear", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "blitFramebuffer", "flush", "finish"];
    const prototypes = [window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype].filter(Boolean);
    let patchedMethods = 0;
    prototypes.forEach((prototype) => {
      methodNames.forEach((name) => {
        const nativeMethod = prototype[name];
        if (typeof nativeMethod !== "function" || nativeMethod.__coffeeBeanRenderHook) return;
        const wrappedMethod = function (...args) {
          if (shouldSuppressRender()) return undefined;
          return nativeMethod.apply(this, args);
        };
        Object.defineProperty(wrappedMethod, "__coffeeBeanRenderHook", { value: true });
        try {
          Object.defineProperty(prototype, name, { configurable: true, writable: true, value: wrappedMethod });
          patchedMethods++;
        } catch (_) {}
      });
    });
    renderPatched = patchedMethods > 0;
  }
  function handleCommand(command) {
    if (!command || typeof command !== "object") return;
    if (command.action === "configure") configure(command.config);
    else if (command.action === "load") { try { void loadVideo(command.video).catch((error) => console.error("[CoffeeBean] invalid video", error)); } catch (error) { console.error("[CoffeeBean] invalid video", error); } }
    else if (command.action === "new-recording") resetLevel(true);
    else if (command.action === "rng-seed") rng.setSeed(command.value);
    else if (command.action === "rng-state") rng.setState(command.value);
    else if (command.action === "save-state") void saveState(command.slot).catch((error) => console.error("[CoffeeBean] savestate failed", error));
    else if (command.action === "load-state") void loadState(command.slot).catch((error) => console.error("[CoffeeBean] savestate load failed", error));
    else if (command.action === "play-state") void playState(command.slot).catch((error) => console.error("[CoffeeBean] savestate playback failed", error));
    else handleAction(command.action);
  }
  function handleRequest(command) {
    if (!command || typeof command !== "object") throw new Error("Invalid request");
    if (command.action === "export") return { tas: exportTas(), frames: control.frame, rngFrames: recorder.rngRecordedFrames };
    if (command.action === "load") return loadVideo(command.video).then(() => ({ loaded: true, frames: slots[0].pauseFrame, rngRuns: slots[0].rngRuns.length }));
    if (command.action === "rng-seed") return rng.setSeed(command.value);
    if (command.action === "rng-state") return rng.setState(command.value);
    if (command.action === "tap") return queueTap(command.input);
    if (command.action === "takeover") return takeoverPlayback();
    if (command.action === "rng-scan") { rng.ensure(true); return rng.getStatus(); }
    if (command.action === "save-state") return saveState(command.slot);
    if (command.action === "load-state") return loadState(command.slot);
    if (command.action === "play-state") return playState(command.slot);
    if (command.action === "status") return lastStatus;
    handleCommand(command);
    return { ok: true };
  }

  document.addEventListener(`${CHANNEL}:command`, (event) => {
    try { handleCommand(JSON.parse(event.detail)); } catch (_) {}
  });
  document.addEventListener(`${CHANNEL}:request`, (event) => {
    let request = null;
    try {
      request = JSON.parse(event.detail);
      Promise.resolve(handleRequest(request.command)).then((result) => {
        document.dispatchEvent(new CustomEvent(`${CHANNEL}:response`, { detail: JSON.stringify({ id: request.id, ok: true, result }) }));
      }).catch((error) => {
        document.dispatchEvent(new CustomEvent(`${CHANNEL}:response`, { detail: JSON.stringify({ id: request.id, ok: false, error: error && error.message ? error.message : String(error) }) }));
      });
    } catch (error) {
      document.dispatchEvent(new CustomEvent(`${CHANNEL}:response`, { detail: JSON.stringify({ id: request && request.id, ok: false, error: error && error.message ? error.message : String(error) }) }));
    }
  });
  normalizeConfig(DEFAULT_CONFIG);
  installTimeHook();
  installRafHook();
  installRenderHook();
  window.addEventListener("keydown", (event) => onKey(event, true), true);
  window.addEventListener("keyup", (event) => onKey(event, false), true);
  window.addEventListener("mousedown", (event) => onMouse(event, "mousedown"), true);
  window.addEventListener("mouseup", (event) => onMouse(event, "mouseup"), true);
  window.addEventListener("mousemove", (event) => onMouse(event, "mousemove"), true);
  window.addEventListener("blur", () => {
    gameKeyCodes().forEach((code, action) => {
      if (recorder.physicalStates[action]) queueGameInput(code, false);
    });
  });

  window._keydown = registerKeydown;
  window._keyup = registerKeyup;
  window.load = loadVideo;
  window.loadFullgame = (encoded) => { try { fullgameVideo = JSON.parse(encoded); } catch (_) { fullgameVideo = null; } };
  window.clearFullgame = () => { fullgameVideo = null; };
  window.startLeft = () => { initialDirection = 1; };
  window.startRight = () => { initialDirection = 2; };
  window.startNeutral = () => { initialDirection = 0; };
  window.useFrame = (length) => { if (Number(length) > 0) setFrameRate(1000 / Number(length)); };
  window.coffee = Object.assign(window.coffee || {}, { onScene, __coffeeBean: true });
  window.__coffeeBean = {
    version: VERSION,
    configure,
    command: handleAction,
    getStatus: () => lastStatus,
    getVideo: (slot = 0) => slots[slot] ? slots[slot].toString() : "",
    exportTas,
    loadTas: loadVideo,
    getRng: () => rng.getStatus(),
    setRngSeed: (value) => rng.setSeed(value),
    setRngState: (value) => rng.setState(value),
    setTap: queueTap,
    takeoverPlayback,
    isFastForwarding: () => false,
    getVirtualTimeSeconds: () => (fakeTime - recordingStartTime) / 1000,
    getClockTimeSeconds: () => fakeTime / 1000,
    saveState,
    loadState,
    playState,
    setFrameRate,
    beginRecording,
    exportProject,
    importProject,
    downloadProject
  };
  emitStatus();
})();
