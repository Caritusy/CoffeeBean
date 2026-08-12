# IWPC WASM test

This directory contains the supplied Godot 4.4.1 Web export assets and the CoffeeBean TAS workspace. `index.html` owns the persistent GUI and defaults to the disposable hitbox runtime from `game-hitbox.html`; the `Production / Clean` button switches to `game.html` for clean capture output. The hitbox runtime loads `index_hitbox.pck`, which preserves the normal `index_charge_fast.pck` game and adds a global collision overlay: bricks are blue, lethal objects red, the player green, interactables purple, and the player's attack black. The normal runtime loads `index_charge_fast.pck`, in which Adam Smasher always chooses `AttackNormal`; beat-driven movable objects and audio timing use the fixed CoffeeBean clock, Augusta's launcher is deterministic, and the first-stage violin rhythm plus fourth-stage candy trap use their TAS patches. The original game data is preserved as `index.pck`.

The workspace starts paused and uses the project's 120 FPS physics tick as its only frame standard. It shows both that project target and the measured runtime FPS, and provides live frame/RNG data, keyboard and canvas-mouse recording, next-frame input indicators, mouse-click Tap actions, eight replay-checkpoint slots with Save/Load/Play actions, confirmed reset, and `.cbproj` project save/open controls. Keyboard transitions are reduced to their final per-frame state and do not synthesize Tap. Physical game input is consumed during replay. Pause and use Take over recording to truncate the replay at the current frame and resume TAS recording. Load reloads only the game iframe, starts a fresh instance, and replays the 120 Hz timeline at project speed to the saved frame before pausing. Play performs the same rebuild/replay and then continues recording with normal input at project speed. Accelerated replay is disabled because it changes IWPC route behavior. `R` is recorded as the game's respawn input; TAS reset is GUI-only.

Start the local server from `D:/ProjCodeJS/CoffeeBean`:

```powershell
node test/server.mjs
```

Open `http://127.0.0.1:4173/game/iwpc/index.html`, then load the unpacked extension from `D:/ProjCodeJS/CoffeeBean` in the browser extensions page.
