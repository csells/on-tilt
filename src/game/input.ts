import type { Game } from '../engine/game';

export interface InputConfig {
  /** Delayed Auto Shift: ms before horizontal auto-repeat begins */
  das: number;
  /** Auto Repeat Rate: ms between repeated shifts (0 = instant to wall) */
  arr: number;
  /** Soft drop: ms between rows (0 = instant to floor) */
  sdr: number;
}

export const DEFAULT_INPUT: InputConfig = { das: 130, arr: 20, sdr: 25 };

export type Action =
  | 'left'
  | 'right'
  | 'softdrop'
  | 'harddrop'
  | 'cw'
  | 'ccw'
  | 'r180'
  | 'hold'
  | 'nudgeL'
  | 'nudgeR'
  | 'pause'
  | 'restart'
  | 'mute'
  | 'music';

export const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'softdrop',
  KeyS: 'softdrop',
  Space: 'harddrop',
  ArrowUp: 'cw',
  KeyX: 'cw',
  KeyW: 'cw',
  KeyZ: 'ccw',
  ControlLeft: 'ccw',
  ControlRight: 'ccw',
  KeyF: 'r180',
  KeyQ: 'nudgeL',
  KeyE: 'nudgeR',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
  KeyC: 'hold',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
  KeyN: 'music',
};

export interface InputCallbacks {
  onPause(): void;
  onRestart(): void;
  onMute(): void;
  onMusic(): void;
  onAnyKey(): void;
}

/**
 * Keyboard + touch input with DAS/ARR handling. `update(dt)` must be called every
 * frame so auto-repeat can be driven by game time rather than OS key repeat.
 */
export class Input {
  config: InputConfig = { ...DEFAULT_INPUT };
  private game: Game;
  private cb: InputCallbacks;
  private held = new Set<Action>();
  private horizontal: 'left' | 'right' | null = null;
  private dasTimer = 0;
  private arrTimer = 0;
  private sdTimer = 0;
  private enabled = true;

  constructor(game: Game, cb: InputCallbacks) {
    this.game = game;
    this.cb = cb;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
  }

  setGame(game: Game): void {
    this.game = game;
    this.releaseAll();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.releaseAll();
  }

  releaseAll(): void {
    this.held.clear();
    this.horizontal = null;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    this.cb.onAnyKey();
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.press(action);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    e.preventDefault();
    this.release(action);
  };

  press(action: Action): void {
    switch (action) {
      case 'pause':
        this.cb.onPause();
        return;
      case 'restart':
        this.cb.onRestart();
        return;
      case 'mute':
        this.cb.onMute();
        return;
      case 'music':
        this.cb.onMusic();
        return;
    }
    if (!this.enabled) return;
    this.held.add(action);
    switch (action) {
      case 'left':
      case 'right':
        this.horizontal = action;
        this.dasTimer = 0;
        this.arrTimer = 0;
        this.game[action === 'left' ? 'moveLeft' : 'moveRight']();
        break;
      case 'softdrop':
        this.sdTimer = 0;
        this.game.softDrop();
        break;
      case 'harddrop':
        this.game.hardDrop();
        break;
      case 'cw':
        this.game.rotateCW();
        break;
      case 'ccw':
        this.game.rotateCCW();
        break;
      case 'r180':
        this.game.rotate180();
        break;
      case 'hold':
        this.game.holdPiece();
        break;
      case 'nudgeL':
      case 'nudgeR':
        this.game.nudge(action === 'nudgeL' ? 'left' : 'right');
        break;
    }
  }

  release(action: Action): void {
    this.held.delete(action);
    if (action === 'left' || action === 'right') {
      if (this.horizontal === action) {
        // fall back to the other direction if it's still held
        const other = action === 'left' ? 'right' : 'left';
        this.horizontal = this.held.has(other) ? other : null;
        this.dasTimer = 0;
        this.arrTimer = 0;
      }
    }
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const { das, arr, sdr } = this.config;

    if (this.horizontal) {
      const move = this.horizontal === 'left' ? () => this.game.moveLeft() : () => this.game.moveRight();
      this.dasTimer += dt;
      if (this.dasTimer >= das) {
        if (arr <= 0) {
          while (move()) {
            /* slide to wall */
          }
        } else {
          this.arrTimer += dt;
          while (this.arrTimer >= arr) {
            this.arrTimer -= arr;
            if (!move()) {
              this.arrTimer = 0;
              break;
            }
          }
        }
      }
    }

    if (this.held.has('softdrop')) {
      if (sdr <= 0) {
        while (this.game.softDrop()) {
          /* to floor */
        }
      } else {
        this.sdTimer += dt;
        while (this.sdTimer >= sdr) {
          this.sdTimer -= sdr;
          if (!this.game.softDrop()) {
            this.sdTimer = 0;
            break;
          }
        }
      }
    }
  }
}

/**
 * Touch gestures on the canvas: tap = rotate CW, swipe left/right = move (continues
 * while dragging), swipe down = soft drop, fast flick down = hard drop, swipe up = hold.
 * Each gesture locks to the axis it starts on, so a slightly crooked downward swipe
 * never nudges the piece sideways (and a sideways drag never soft-drops).
 */
export function attachTouch(el: HTMLElement, input: Input, cellSize: () => number): void {
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let startT = 0;
  let moved = false;
  let axis: 'x' | 'y' | null = null;

  el.addEventListener(
    'touchstart',
    (e) => {
      const t = e.changedTouches[0];
      startX = lastX = t.clientX;
      startY = lastY = t.clientY;
      startT = performance.now();
      moved = false;
      axis = null;
      e.preventDefault();
    },
    { passive: false },
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      const t = e.changedTouches[0];
      const cs = cellSize();
      const dx = t.clientX - lastX;
      const dy = t.clientY - lastY;
      if (!axis) {
        const ax = Math.abs(t.clientX - startX);
        const ay = Math.abs(t.clientY - startY);
        if (ax < cs * 0.6 && ay < cs * 0.6) return;
        // vertical wins ties and near-diagonals: drops are the costly ones to get wrong
        axis = ay >= ax * 0.8 ? 'y' : 'x';
      }
      moved = true;
      if (axis === 'x' && Math.abs(dx) >= cs * 0.8) {
        const steps = Math.floor(Math.abs(dx) / (cs * 0.8));
        for (let i = 0; i < steps; i++) {
          input.press(dx > 0 ? 'right' : 'left');
          input.release(dx > 0 ? 'right' : 'left');
        }
        lastX = t.clientX;
      }
      if (axis === 'y' && dy >= cs * 0.9) {
        const steps = Math.floor(dy / (cs * 0.9));
        for (let i = 0; i < steps; i++) {
          input.press('softdrop');
          input.release('softdrop');
        }
        lastY = t.clientY;
      }
      e.preventDefault();
    },
    { passive: false },
  );

  el.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      const dt = performance.now() - startT;
      const totalDy = t.clientY - startY;
      const cs = cellSize();
      if (!moved && dt < 300) {
        input.press(t.clientX < window.innerWidth / 2 ? 'ccw' : 'cw');
        input.release('cw');
        input.release('ccw');
      } else if (axis === 'y' && totalDy < -cs * 1.5) {
        input.press('hold');
        input.release('hold');
      } else if (axis === 'y' && totalDy > cs * 3 && dt < 250) {
        input.press('harddrop');
        input.release('harddrop');
      }
      e.preventDefault();
    },
    { passive: false },
  );
}
