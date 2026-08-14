import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class EventHub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

class MockEvent {
  constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
  preventDefault() { this.defaultPrevented = true; }
  stopImmediatePropagation() { this.immediatePropagationStopped = true; }
}
class MockCanvas extends EventHub {
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  focus() {}
}

const MASK_64 = (1n << 64n) - 1n;
const MULTIPLIER = 6364136223846793005n;
const DEFAULT_INC = 1442695040888963407n;
const STREAM_INC = ((DEFAULT_INC << 1n) | 1n) & MASK_64;
const write64 = (heap, word, value) => {
  heap[word] = Number(value & 0xffffffffn);
  heap[word + 1] = Number((value >> 32n) & 0xffffffffn);
};
const read64 = (heap, word) => (BigInt(heap[word + 1]) << 32n) | BigInt(heap[word]);

const heap = new Uint32Array(4096);
const heapBytes = new Uint8Array(heap.buffer);
const rngWord = 200;
write64(heap, rngWord, 0x123456789abcdef0n);
write64(heap, rngWord + 2, STREAM_INC);
write64(heap, rngWord + 4, 0xa5a5a5a5a5a5a5a5n);
write64(heap, rngWord + 6, DEFAULT_INC);

const mockCanvas = new MockCanvas();
const document = new EventHub();
document.body = new EventHub();
document.activeElement = null;
document.querySelector = () => mockCanvas;
const window = new EventHub();
window.window = window;
window.document = document;
window.location = { href: "http://127.0.0.1/test" };
let clock = 1000;
let clockStep = 101;
window.performance = { now: () => (clock += clockStep) };
window.setTimeout = setTimeout;
window.clearTimeout = clearTimeout;
window.requestAnimationFrame = (callback) => setTimeout(() => callback(1000), 0);
window.iwpcEngine = { rtenv: { HEAPU32: heap, HEAPU8: heapBytes } };

const waitUntil = async (predicate, timeout = 500) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for frame steps");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const context = vm.createContext({
  window,
  document,
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  Blob,
  CompressionStream,
  DecompressionStream,
  Response,
  Date,
  Uint8Array,
  Uint32Array,
  BigInt,
  JSON,
  Math,
  Object,
  Number,
  String,
  Array,
  Map,
  WeakSet,
  Proxy,
  Error,
  HTMLCanvasElement: MockCanvas,
  KeyboardEvent: MockEvent,
  MouseEvent: MockEvent,
  CustomEvent: MockEvent,
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  atob: (value) => Buffer.from(value, "base64").toString("binary")
});

vm.runInContext(await readFile(new URL("../coffee-main.js", import.meta.url), "utf8"), context, { filename: "coffee-main.js" });

const detected = window.__coffeeBean.getRng();
assert.equal(detected.detected, true);
assert.equal(detected.address, `0x${(rngWord * 4).toString(16)}`);
assert.equal(detected.candidates, 1, "deterministic playback requires exactly one Godot PCG state");
assert.equal(window.__coffeeBean.getStatus().frameRate, 120);
assert.equal(window.__coffeeBean.getStatus().frameLength, 1000 / 120);
assert.equal(typeof window.__coffeeBean.getStatus().measuredFrameRate, "number");
assert.equal(typeof window.__coffeeBean.getClockTimeSeconds(), "number");
await assert.rejects(
  window.__coffeeBean.downloadProject("empty.cbproj"),
  /Project is empty/,
  "the UI must not silently download an empty project"
);

const iwpcPack = await readFile(new URL("../game/iwpc/index_charge_fast.pck", import.meta.url));
const physicsTickKey = Buffer.from("physics/common/physics_ticks_per_second");
const physicsTickOffset = iwpcPack.indexOf(physicsTickKey);
assert.ok(physicsTickOffset >= 0, "IWPC project physics tick setting must exist in the PCK");
assert.equal(iwpcPack.readInt32LE(physicsTickOffset + physicsTickKey.length + 8), 120);

const duplicateRngWord = 320;
write64(heap, duplicateRngWord, 0x8877665544332211n);
write64(heap, duplicateRngWord + 2, STREAM_INC);
write64(heap, duplicateRngWord + 4, 0x0101010101010101n);
write64(heap, duplicateRngWord + 6, DEFAULT_INC);
assert.throws(() => window.__coffeeBean.setRngState("0x1"), /ambiguous \(2 PCG states\)/);
assert.equal(window.__coffeeBean.getRng().candidates, 2);
heap.fill(0, duplicateRngWord, duplicateRngWord + 8);

window.__coffeeBean.setRngState("0x0102030405060708");
assert.equal(read64(heap, rngWord), 0x0102030405060708n);

const seed = 0x1122334455667788n;
window.__coffeeBean.setRngSeed(`0x${seed.toString(16)}`);
const expectedState = (((STREAM_INC + seed) & MASK_64) * MULTIPLIER + STREAM_INC) & MASK_64;
assert.equal(read64(heap, rngWord), expectedState);
assert.equal(read64(heap, rngWord + 4), seed);

await new Promise((resolve) => window.requestAnimationFrame(resolve));
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));

const observedInputs = [];
const observedPlayback = [];
document.addEventListener("coffeebean:status", (event) => {
  const status = JSON.parse(event.detail);
  const right = status.inputs && status.inputs.find((input) => input.action === "right");
  if (right && status.frame > 0) observedInputs.push([status.frame, right.state]);
  if (status.playback) observedPlayback.push({ frame: status.frame, target: status.playbackTargetFrame, mode: status.playbackMode, speed: status.speed });
});

let steppedFrames = 0;
const frameLoop = () => window.requestAnimationFrame(() => { steppedFrames++; frameLoop(); });
frameLoop();
window.dispatchEvent(new MockEvent("keydown", { code: "KeyD", keyCode: 68, repeat: false }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: true }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: true }));
await waitUntil(() => steppedFrames === 3);

assert.equal(steppedFrames, 3);
assert.deepEqual(observedInputs.filter(([frame]) => frame >= 2).slice(0, 3).map(([, state]) => state), ["Pressed", "Held", "Held"]);

window.dispatchEvent(new MockEvent("keyup", { code: "KeyD", keyCode: 68, repeat: false }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: true }));
await waitUntil(() => steppedFrames === 4);
assert.equal(steppedFrames, 4);
assert.equal(window.__coffeeBean.getStatus().inputs.find((input) => input.action === "right").state, "Released");

window.dispatchEvent(new MockEvent("mousedown", { target: mockCanvas, clientX: 40, clientY: 60, button: 0, buttons: 1 }));
window.dispatchEvent(new MockEvent("mouseup", { target: mockCanvas, clientX: 40, clientY: 60, button: 0, buttons: 0 }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
await waitUntil(() => steppedFrames === 5);
assert.equal(window.__coffeeBean.getStatus().mouseActions, 2);

const tas = window.__coffeeBean.exportTas();
assert.match(tas, /^CB2:/);

const encoded = tas.slice(4).replace(/-/g, "+").replace(/_/g, "/");
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
assert.equal(payload.version, 3);
assert.deepEqual(payload.inputLayout, ["left", "right", "action", "jump", "respawn"]);
assert.equal(payload.video.actions.length, 2);
assert.equal(payload.video.mouseActions.length, 2);
assert.equal(payload.video.actions[0].frame, 1);
assert.equal(payload.video.actions[0].down, true);
assert.equal(payload.video.actions[1].down, false);
assert.equal(payload.rng.algorithm, "pcg32");
assert.ok(payload.rng.runs.length >= 1);

const savedRngState = read64(heap, rngWord);
const hostOnlyByte = 77;
heapBytes[hostOnlyByte] = 0x31;
const savedState = await window.__coffeeBean.saveState(0);
assert.equal(savedState.actions, 2);
assert.equal(window.__coffeeBean.getStatus().savestates[0].actions, 2);
window.__coffeeBean.setRngState("0xffffffffffffffff");
heapBytes[hostOnlyByte] = 0xe7;
assert.notEqual(read64(heap, rngWord), savedRngState);
const loadedState = await window.__coffeeBean.loadState(0);
assert.equal(read64(heap, rngWord), savedRngState);
assert.equal(heapBytes[hostOnlyByte], 0xe7, "load must not overwrite unrelated WASM memory");
assert.equal(loadedState.frame, savedState.frame);
assert.equal(window.__coffeeBean.getStatus().paused, true);
assert.equal(window.__coffeeBean.getStatus().playback, false);
assert.ok(observedPlayback.some((status) => status.mode === "load" && status.target === savedState.frame));
assert.ok(observedPlayback.some((status) => status.mode === "load" && status.speed === "normal"), "checkpoint replay must use the recorded project speed");
assert.equal(window.__coffeeBean.isFastForwarding(), false);

window.dispatchEvent(new MockEvent("keydown", { code: "KeyQ", keyCode: 81, repeat: false }));
await waitUntil(() => !window.__coffeeBean.getStatus().savestateBusy);
window.__coffeeBean.setRngState("0xdddddddddddddddd");
window.dispatchEvent(new MockEvent("keydown", { code: "KeyW", keyCode: 87, repeat: false }));
await waitUntil(() => !window.__coffeeBean.getStatus().savestateBusy);
assert.equal(read64(heap, rngWord), savedRngState);

const playbackFromState = await window.__coffeeBean.playState(0);
assert.equal(playbackFromState.playing, true);
assert.equal(window.__coffeeBean.getStatus().paused, false);
const beforeStatePlaybackFrames = steppedFrames;
await waitUntil(() => steppedFrames > beforeStatePlaybackFrames);
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));
assert.equal(window.__coffeeBean.getStatus().paused, true);

clockStep = 10;
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));
assert.equal(window.__coffeeBean.getStatus().paused, false);
const beforePauseToggleFrames = steppedFrames;
const scheduledDelays = [];
const delegateTimeout = window.setTimeout;
window.setTimeout = (callback, delay = 0) => {
  scheduledDelays.push(Number(delay) || 0);
  return delegateTimeout(callback, delay);
};
await waitUntil(() => steppedFrames > beforePauseToggleFrames);
assert.equal(scheduledDelays[0], 0, "normal scheduler must phase-correct ordinary callback overhead to sustain 120 Hz");
window.setTimeout = delegateTimeout;
clockStep = 101;
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));
assert.equal(window.__coffeeBean.getStatus().paused, true);
const pausedAtFrame = steppedFrames;
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(steppedFrames, pausedAtFrame);
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));
await waitUntil(() => steppedFrames > pausedAtFrame);
assert.equal(window.__coffeeBean.getStatus().paused, false);
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));
assert.equal(window.__coffeeBean.getStatus().paused, true);

const project = await window.__coffeeBean.exportProject();
assert.ok(project.size > 0);
assert.ok(project.size < 100_000, "replay checkpoint projects should not contain WASM memory dumps");
window.__coffeeBean.setRngState("0xeeeeeeeeeeeeeeee");
heapBytes[hostOnlyByte] = 0xab;
const imported = await window.__coffeeBean.importProject(project);
assert.equal(imported.savestates, 1);
assert.equal(read64(heap, rngWord), savedRngState);
assert.equal(heapBytes[hostOnlyByte], 0xab);

// A held key at the checkpoint must remain held after the iframe replay. The
// reload must not manufacture a release transition from pre-reload host state.
window.__coffeeBean.beginRecording();
assert.equal(window.__coffeeBean.setTap("left"), true);
assert.equal(window.__coffeeBean.getStatus().inputs.find((input) => input.action === "left").next, "Tap");
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
await waitUntil(() => window.__coffeeBean.getStatus().frame === 1);
assert.equal(window.__coffeeBean.getStatus().inputs.find((input) => input.action === "left").state, "Tapped");
assert.equal(window.__coffeeBean.getStatus().inputs.find((input) => input.action === "left").next, "Neutral");

window.__coffeeBean.beginRecording();
window.dispatchEvent(new MockEvent("keydown", { code: "KeyD", keyCode: 68, repeat: false }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
await waitUntil(() => window.__coffeeBean.getStatus().frame === 1);
const heldState = await window.__coffeeBean.saveState(1);
assert.equal(heldState.frame, 1);
const heldBeforeLoad = window.__coffeeBean.getStatus().inputs.find((input) => input.action === "right");
assert.equal(heldBeforeLoad.state, "Pressed");
await window.__coffeeBean.loadState(1);
const heldAfterLoad = window.__coffeeBean.getStatus().inputs.find((input) => input.action === "right");
assert.equal(heldAfterLoad.state, "Held");
assert.equal(heldAfterLoad.next, "Held");

assert.equal(window.__coffeeBean.setFrameRate(30), 120);
assert.equal(window.__coffeeBean.setFrameRate(240), 120);
assert.equal(window.__coffeeBean.getStatus().frameRate, 120);

const gameHtml = await readFile(new URL("../game/iwpc/game.html", import.meta.url), "utf8");
assert.match(gameHtml, /mainPack:\s*"index_charge_fast\.pck"/);
const workspaceHtml = await readFile(new URL("../game/iwpc/index.html", import.meta.url), "utf8");
assert.match(workspaceHtml, /id="takeover-run"/);
assert.match(workspaceHtml, /data-tas-input="respawn"/);
const fastPack = await readFile(new URL("../game/iwpc/index_charge_fast.pck", import.meta.url));
assert.ok(fastPack.indexOf(physicsTickKey) >= 0, "patched PCK must retain the 120 Hz project setting");
const adamPatch = await readFile(new URL("../game/iwpc/patches/adam_charge_only.gdc", import.meta.url));
const audioManagerPatch = await readFile(new URL("../game/iwpc/patches/audio_manager_tas.gdc", import.meta.url));
const movableObjectPatch = await readFile(new URL("../game/iwpc/patches/movable_object_tas.gdc", import.meta.url));
const augustaPatch = await readFile(new URL("../game/iwpc/patches/augusta_tas.gdc", import.meta.url));
const violinPatch = await readFile(new URL("../game/iwpc/patches/violin_skip_enlarge.gdc", import.meta.url));
assert.ok(fastPack.indexOf(adamPatch) >= 0, "runtime PCK must contain Adam's deterministic straight-punch/uppercut selector");
assert.ok(fastPack.indexOf(audioManagerPatch) >= 0, "runtime PCK must contain deterministic AudioManager bytecode");
assert.ok(fastPack.indexOf(movableObjectPatch) >= 0, "runtime PCK must use the fixed TAS clock for beat-driven movable objects");
assert.ok(fastPack.indexOf(augustaPatch) >= 0, "runtime PCK must contain the targeted Augusta timing patch");
assert.ok(fastPack.indexOf(violinPatch) >= 0, "runtime PCK must contain the targeted fourth-stage violin enlargement skip");
const hitboxPack = await readFile(new URL("../game/iwpc/index_hitbox.pck", import.meta.url));
assert.ok(hitboxPack.indexOf(Buffer.from("CoffeeBeanHitbox.gdc")) >= 0, "hitbox PCK must contain the overlay script");
assert.ok(hitboxPack.indexOf(adamPatch) >= 0, "hitbox PCK must use the same deterministic Adam selector as the clean runtime");
assert.ok(hitboxPack.indexOf(physicsTickKey) >= 0, "hitbox PCK must retain the 120 Hz project setting");
const hitboxHtml = await readFile(new URL("../game/iwpc/game-hitbox.html", import.meta.url), "utf8");
assert.match(hitboxHtml, /mainPack:\s*"index_hitbox\.pck"/);
assert.match(hitboxHtml, /id="boss-armor-frames"/);
assert.match(hitboxHtml, /id="boss-next-action"/);
assert.match(hitboxHtml, /id="boss-rng-audit"/);
const adamSource = await readFile(new URL("../game/iwpc/patches/adam_charge_only.gd", import.meta.url), "utf8");
assert.match(adamSource, /height_diff >= ATTACK_UP_HEIGHT_THRESHOLD and distance <= ATTACK_MAX_DISTANCE/);
assert.match(adamSource, /return ActionType\.AttackUp/);
assert.match(adamSource, /return ActionType\.AttackNormal/);
assert.match(workspaceHtml, /src="game-hitbox\.html"/);

await window.__coffeeBean.loadTas(tas);
assert.equal(window.__coffeeBean.getStatus().paused, true);

// Physical input must not perturb playback. Pausing and explicitly taking over
// truncates the replay at the current frame and returns to recording mode.
const takeoverPayload = JSON.parse(Buffer.from(tas.slice(4), "base64url").toString("utf8"));
takeoverPayload.video.pauseFrame = 10_000;
const takeoverTas = `CB2:${Buffer.from(JSON.stringify(takeoverPayload)).toString("base64url")}`;
const takeoverReplay = window.__coffeeBean.loadTas(takeoverTas);
await Promise.resolve();
assert.equal(window.__coffeeBean.getStatus().playback, true);
window.dispatchEvent(new MockEvent("keydown", { code: "KeyP", keyCode: 80, repeat: false }));
assert.equal(window.__coffeeBean.getStatus().paused, true);
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: true }));
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: true }));
await waitUntil(() => window.__coffeeBean.getStatus().frame === 3);
assert.equal(window.__coffeeBean.getStatus().rngAudit.status, "LOCKED");
assert.ok(window.__coffeeBean.getStatus().rngAudit.verifiedFrames >= 2);
window.__coffeeBean.setRngState("0x0badf00d0badf00d");
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
await waitUntil(() => window.__coffeeBean.getStatus().rngAudit.status === "DESYNC");
assert.equal(window.__coffeeBean.getStatus().rngAudit.desyncFrame, 3);
assert.equal(window.__coffeeBean.getStatus().frame, 3, "a divergent RNG frame must not execute");
assert.equal(window.__coffeeBean.getStatus().paused, true);
const blockedLeft = new MockEvent("keydown", { code: "KeyA", keyCode: 65, repeat: false });
window.dispatchEvent(blockedLeft);
assert.equal(blockedLeft.defaultPrevented, true);
assert.equal(blockedLeft.immediatePropagationStopped, true);
assert.equal(window.__coffeeBean.getStatus().inputs.find((input) => input.action === "left").next, "Neutral");
const takeoverResult = window.__coffeeBean.takeoverPlayback();
assert.equal(takeoverResult.frame, 3);
assert.equal(takeoverResult.takeover, true);
assert.equal((await takeoverReplay).takeover, true);
assert.equal(window.__coffeeBean.getStatus().playback, false);
assert.equal(window.__coffeeBean.getStatus().paused, true);
const truncatedPayload = JSON.parse(Buffer.from(window.__coffeeBean.exportTas().slice(4), "base64url").toString("utf8"));
assert.deepEqual(truncatedPayload.video.actions, [{ frame: 1, code: 1, down: true }]);

// Version-6 projects may still contain reset: KeyR. Migration must discard it
// and record R as the game's respawn input instead of resetting the TAS.
window.__coffeeBean.configure({ controls: { reset: "KeyR" }, gameKeys: { respawn: "KeyR" } });
const respawnDown = new MockEvent("keydown", { code: "KeyR", keyCode: 82, repeat: false });
window.dispatchEvent(respawnDown);
assert.equal(respawnDown.defaultPrevented, true);
assert.equal(window.__coffeeBean.getStatus().frame, 3);
assert.equal(window.__coffeeBean.getStatus().inputs.find((input) => input.action === "respawn").next, "Press");
window.dispatchEvent(new MockEvent("keydown", { code: "Space", keyCode: 32, repeat: false }));
await waitUntil(() => window.__coffeeBean.getStatus().frame === 4);
const respawnPayload = JSON.parse(Buffer.from(window.__coffeeBean.exportTas().slice(4), "base64url").toString("utf8"));
assert.ok(respawnPayload.video.actions.some((action) => action.frame === 3 && action.code === 4 && action.down));

// An empty project restores to frame zero. It must still publish a playback
// status before its terminal paused status so the workspace can finish Open.
window.__coffeeBean.beginRecording();
const emptyTas = window.__coffeeBean.exportTas();
const playbackStatusesBeforeEmptyLoad = observedPlayback.length;
const emptyLoad = await window.__coffeeBean.loadTas(emptyTas);
assert.equal(emptyLoad.frame, 0);
assert.equal(window.__coffeeBean.getStatus().paused, true);
assert.ok(
  observedPlayback.slice(playbackStatusesBeforeEmptyLoad).some((status) => status.mode === "load" && status.target === 0),
  "frame-zero TAS load must announce playback before completing"
);
window.__coffeeBean.command("fast");
assert.equal(window.__coffeeBean.getStatus().speed, "normal");
assert.equal(window.__coffeeBean.isFastForwarding(), false);
window.__coffeeBean.command("pause");
assert.equal(window.__coffeeBean.getStatus().paused, true);
console.log("CoffeeBean replay checkpoints and 120 FPS project-tick tests passed");
