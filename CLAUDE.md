# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**On Tilt**: a falling-block game (Tetris rules underneath) in TypeScript + Vite + Canvas 2D. The player-facing name avoids "Tetris", a trademark of The Tetris Company; keep it that way in anything user-visible. No runtime dependencies, no asset files (audio is synthesized with Web Audio, fonts come from Google Fonts with system fallbacks). Guideline rules: SRS with wall kicks, 7-bag, hold, 5-piece preview, ghost, DAS/ARR, lock delay with move reset, T-spin detection, back-to-back, combos, perfect clears. The twists are **color match** and **cascade gravity**. Pieces are dealt random colors from `MATCH_PALETTE` (independent of shape; `queueColors`/`holdColor` parallel `queue`/`hold`, and `ActivePiece.color` is what locks into the grid), and any 4-connected same-color group of `matchSize` or more cells pops; `colorMatch: 0` restores per-shape colors and no pops. Difficulty comes from **rising garbage** (gray `GARBAGE` cells pushed in from the bottom every `garbageInterval()` pieces, one hole per row; they never match but break when a touching group pops) and **level rules** (`colorCount` gains a 5th color at `EXTRA_COLOR_LEVEL`, `matchSize` grows by 2 at `BIGGER_MATCH_LEVEL`). Levels advance on `progress` = lines + popped groups. The player can also **nudge** (`nudge(dir)`, Q/E or the pad's NUDGE buttons): a quick player-triggered tilt that sets the falling piece aside (`resume`) and hands it back afterwards, lifted clear if needed. Each nudge adds `nudgeHeat` to the `heat` meter, which cools over time; a nudge that would reach `MAX_HEAT` tilts out instead (`tiltedFor` ms of dead controls plus a garbage row). Two more systems ride on top: scheduled **tilts** (every `tiltEvery` pieces the board turns 90° toward the announced `tiltDir`; `Board.settle(dir)` slides chunks sideways in the `tilting` phase, then everything settles down again, with any clears scored as chain steps) and **rhythm** (the host sets `game.beatClock` to the music's signed ms-from-beat; each lock within `beatWindow` builds `groove`, which multiplies clear points by `grooveMultiplier`, up to ×3). For cascade gravity, after a clear, every 4-connected chunk of blocks *from the same piece* falls rigidly (pieces don't glue to each other, so overhangs drop into holes), and lines it completes clear as chain steps whose points double each step (`cascade: false` restores classic row shifting).

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — typecheck (`tsc --noEmit`) then production build to `dist/`
- `npm run typecheck` — `tsc --noEmit` only
- `npm test` — run vitest once; `npm run test:watch` for watch mode
- Single test file: `npx vitest run src/engine/__tests__/game.test.ts`
- Single test by name: `npx vitest run -t "T-spin double"`

Tests cover `src/engine/` (pure game logic) and the pure shake detector in `src/game/shake.ts`; nothing else touches the DOM in tests. Renderer/audio/input are verified by running the app.

## Architecture

Three layers, with a strict dependency direction: `engine` ← `game`/`audio` ← `main.ts`.

**`src/engine/` — pure game logic, no DOM.**
- `pieces.ts`: tetromino shapes as 4 rotation states derived by rotating the state-0 bounding box (this reproduces SRS exactly), colors, and SRS kick tables. Kick tables are stored with **+y = down** (already converted from the guideline's +y-up convention) — do not "fix" the signs.
- `board.ts`: 10×40 grid plus a parallel `ids` grid recording which locked piece each cell came from (0 = written directly, as in tests; those cells all count as one piece); rows 0–19 are the hidden buffer, 20–39 are visible (`HIDDEN_ROWS`, `VISIBLE_HEIGHT`). Row 0 is the top. All coordinates in the engine use this 40-row space; the renderer subtracts `HIDDEN_ROWS`.
- `bag.ts`: seeded 7-bag randomizer (`mulberry32`); pass `seed` to `Game` for deterministic games/tests.
- `game.ts`: the `Game` state machine. Phases: `ready → falling → clearing → settling → (clearing → settling)* → falling`, or `over`. Input methods (`moveLeft`, `rotateCW`, `hardDrop`, `holdPiece`, …) mutate state immediately; `tick(dt)` advances gravity, lock delay, and the line-clear animation timer. All side effects are reported through `game.on(event)` — the engine never touches audio or rendering.
  - Scoring/T-spin/B2B/combo logic lives in `scoreClear` and `detectTSpin`. T-spin requires the last successful action to be a rotation (`lastMoveWasRotate`), 3+ filled corners, and is "full" if both front corners are filled or the 5th SRS kick was used.
  - Line clears happen in steps: `lockPiece` awards points and enters `clearing` with rows kept in the grid (so the renderer can animate them); after `config.clearDelay`, `finishClear` blanks the rows and runs `Board.settle()`, entering `settling` while chunks fall (`fallOffset(x, y)` gives the renderer each cell's remaining height). `finishSettle` either starts the next chain clear (`chain` 2+, scored without touching b2b/combo) or spawns. Every step clears full rows *and* popped groups together (`clearingCells`); `previewPops()` tells the renderer whether the ghost position would pop. Piece gravity runs `gravityBoost` (default 3) levels ahead of the displayed level. Garbage rises in `nextPiece()` between pieces, never under a falling piece. Tests pass `clearDelay: 0, cascadeGravity: 0, garbageEvery: 0` (and `colorMatch: 0` wherever they fill rows with one letter) so one `tick(1)` resolves the whole chain.

**`src/game/` — browser presentation.**
- `renderer.ts`: single full-window canvas, DPR-aware. Layout (cell size, panel positions) is recomputed in `resize()`; blocks are drawn from cached pre-rendered sprites keyed by type/brightness/size. Effects (particles, screen shake, floating text, lock flashes, hue shifts) are fed by `on*` methods that `main.ts` calls from game events.
- `shake.ts`: shake-to-nudge. `ShakeDetector` (pure, tested) turns devicemotion samples into left/right shoves in screen terms; `ShakeNudge` listens and handles the iOS motion-permission prompt, which `main.ts` triggers from the first tap release (iOS requires a touchend/click, and a secure context).
- `input.ts`: keyboard + touch. DAS/ARR/soft-drop repeat are driven from `update(dt)` in the frame loop, not OS key repeat. `KEYMAP` maps `KeyboardEvent.code` to actions.

**`src/audio/sfx.ts`** — Web Audio synth for SFX plus a 16th-note chiptune sequencer (Korobeiniki). `unlock()` must be called from a user gesture; `updateMusic()` is called each frame to schedule ahead. It records scheduled beat times (every bass hit) for `beatOffsetMs()`/`beatPhase()`, pitches action sounds from the current bass note (`chord()`), and thickens the arrangement every two levels (`tier`); the renderer swaps its background scene on the same tiers.

**`src/main.ts`** wires it together: creates `Game`, subscribes to its events to drive renderer + audio, runs the `requestAnimationFrame` loop (`input.update → game.tick → renderer.update/draw`), and manages the start/pause/game-over overlay and `localStorage` high score.

## Conventions

- Adding a game mechanic: implement it in `engine/`, emit a `GameEvent` for it, add a test, then react to the event in `main.ts`.
- `.cptr/` is tool-generated chat history — leave it alone.
