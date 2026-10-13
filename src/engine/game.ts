import { mulberry32, SevenBag } from './bag';
import { Board, GARBAGE, HIDDEN_ROWS, type ActivePiece, type FallDir } from './board';
import { cellsOf, kicksFor, type PieceType, type Rotation } from './pieces';

export type TSpinKind = 'none' | 'mini' | 'full';

export interface ClearEvent {
  rows: number[];
  count: number;
  tspin: TSpinKind;
  b2b: boolean;
  combo: number;
  perfect: boolean;
  points: number;
  label: string;
  /** 1 for the clear made by the piece itself, 2+ for clears caused by cascading blocks */
  chain: number;
  /** same-color groups that popped in this step, as [x, y] cells (the group's color is `color`) */
  pops: { color: PieceType; cells: [number, number][] }[];
  /** garbage cells broken because they touched a popping group */
  garbage: [number, number][];
}

export type GameEvent =
  | { type: 'move' }
  | { type: 'rotate'; tspin: TSpinKind }
  | { type: 'softdrop' }
  | { type: 'harddrop'; distance: number }
  | { type: 'hold' }
  | { type: 'lock'; piece: ActivePiece }
  | { type: 'clear'; clear: ClearEvent }
  | { type: 'cascade'; chain: number; maxDrop: number }
  | { type: 'landed'; cells: [number, number][]; chain: number }
  | { type: 'levelup'; level: number }
  | { type: 'garbage'; rows: number }
  | { type: 'tilt'; dir: 'left' | 'right'; nudge: boolean }
  | { type: 'tilted' }
  | { type: 'beat'; onBeat: boolean; groove: number; offset: number }
  | { type: 'spawn'; piece: ActivePiece }
  | { type: 'gameover' };

export interface GameConfig {
  seed?: number;
  startLevel?: number;
  /** ms a piece may rest before locking */
  lockDelay?: number;
  /** max number of lock-delay resets per piece */
  maxLockResets?: number;
  /** ms the line-clear animation freezes the game */
  clearDelay?: number;
  previewCount?: number;
  /** after a clear, unsupported chunks fall and can set off chain clears (false = classic) */
  cascade?: boolean;
  /** acceleration of falling chunks in rows/s²; 0 = land instantly */
  cascadeGravity?: number;
  /** piece gravity runs this many guideline levels ahead of the displayed level */
  gravityBoost?: number;
  /** a touching group of at least this many same-colored cells pops; 0 = off (cells keep piece colors) */
  colorMatch?: number;
  /** how many colors pieces are dealt from when colorMatch is on (one more from level 4) */
  colors?: number;
  /** a garbage row rises every this many pieces at level 1, one fewer per level (min 3); 0 = off */
  garbageEvery?: number;
  /** the board tilts sideways every this many pieces; 0 = off */
  tiltEvery?: number;
  /** ms for the board to turn 90° (each way) during a tilt */
  tiltTurn?: number;
  /** a lock within this many ms of a beat is on the beat */
  beatWindow?: number;
  /** ms for the board to turn 90° when the player nudges it */
  nudgeTurn?: number;
  /** heat each nudge adds to the tilt meter (it tilts out at 100) */
  nudgeHeat?: number;
  /** heat the tilt meter sheds per second */
  heatCool?: number;
  /** ms the controls stay dead after tilting out */
  tiltOutMs?: number;
}

/** The tilt meter's ceiling: a nudge that would reach it tilts the machine out. */
export const MAX_HEAT = 100;
/** Above this the meter shows DANGER: one more nudge may tilt out. */
export const DANGER_HEAT = 60;

/** Groove: each consecutive on-beat lock adds this to the score multiplier, up to MAX_GROOVE locks. */
export const GROOVE_STEP = 0.25;
export const MAX_GROOVE = 8;
/** ms the board holds still, turned, after the stack has slid. */
const TILT_HOLD = 120;

/** Level at which a fifth color is dealt, and at which matches need 2 more cells. */
export const EXTRA_COLOR_LEVEL = 4;
export const BIGGER_MATCH_LEVEL = 6;
const MIN_GARBAGE_EVERY = 3;
const GARBAGE_POINTS = 10;

/** Color keys pieces are dealt from in color-match mode: red, blue, yellow, green, purple. */
export const MATCH_PALETTE: readonly PieceType[] = ['Z', 'J', 'O', 'S', 'T'];

/** Points per popped cell, and per cell beyond the minimum group size. */
const POP_POINTS = 10;
const POP_BONUS = 20;

export type Phase = 'ready' | 'falling' | 'clearing' | 'settling' | 'tilting' | 'over';

/** ms to hold still after chunks land, so the landing reads before the next chain clear */
const SETTLE_PAUSE = 70;

export const LINES_PER_LEVEL = 10;

/** Guideline gravity: seconds per row at a given level. */
export function gravitySeconds(level: number): number {
  const l = Math.max(1, level);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1);
}

const BASE_POINTS: Record<string, number> = {
  '0-none': 0,
  '1-none': 100,
  '2-none': 300,
  '3-none': 500,
  '4-none': 800,
  '0-mini': 100,
  '1-mini': 200,
  '2-mini': 400,
  '0-full': 400,
  '1-full': 800,
  '2-full': 1200,
  '3-full': 1600,
};

const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

export class Game {
  readonly board = new Board();
  readonly config: Required<GameConfig>;

  phase: Phase = 'ready';
  active: ActivePiece | null = null;
  hold: PieceType | null = null;
  holdColor: PieceType | null = null;
  canHold = true;
  queue: PieceType[] = [];
  /** color of each queued piece, parallel to `queue` */
  queueColors: PieceType[] = [];

  score = 0;
  level: number;
  lines = 0;
  combo = -1;
  b2b = -1;
  piecesPlaced = 0;
  elapsed = 0;
  /** current step of a clear resolution: 1 = the piece's own clear, 2+ = cascade chains */
  chain = 0;
  maxChain = 0;

  /** rows currently flashing during the clear animation */
  clearingRows: number[] = [];
  /** every cell being cleared (full rows and popped groups), keyed `y * width + x` */
  clearingCells = new Set<number>();
  /** cells popped in total, across the game */
  popped = 0;
  /** lines cleared plus color groups popped; every LINES_PER_LEVEL of these is a level */
  progress = 0;
  /** pieces left before the next garbage row rises */
  garbageIn = 0;
  private pendingGarbage = 0;

  /** pieces left before the board tilts, and which way it will go */
  tiltIn = 0;
  tiltDir: 'left' | 'right' = 'left';
  /** direction chunks are currently falling (sideways while tilting) */
  fallDir: FallDir = 'down';
  private pendingTilt = false;
  private tiltElapsed = 0;
  private tiltSlide = 0;
  private turnMs = 0;

  /** tilt meter, 0-MAX_HEAT: nudges heat it, time cools it */
  heat = 0;
  /** ms of dead controls left after tilting out */
  tiltedFor = 0;
  /** the falling piece, set aside while a nudge plays out */
  private resume: ActivePiece | null = null;

  /**
   * Signed ms from the nearest beat right now, or null when there's no beat to play to.
   * Set by the host (the music clock); the engine never reads audio itself.
   */
  beatClock: (() => number | null) | null = null;
  /** consecutive on-beat locks */
  groove = 0;
  bestGroove = 0;
  clearTimer = 0;

  /** distance each falling cell will drop, keyed by its final `y * width + x` */
  private drops = new Map<number, number>();
  private settleElapsed = 0;
  private settleTotal = 0;

  private bag: SevenBag;
  private colorRng: () => number;
  private garbageRng: () => number;
  private gravityAcc = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private lowestY = -Infinity;
  private lastMoveWasRotate = false;
  private lastKickIndex = 0;
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(cfg: GameConfig = {}) {
    this.config = {
      seed: cfg.seed ?? Date.now(),
      startLevel: cfg.startLevel ?? 1,
      lockDelay: cfg.lockDelay ?? 500,
      maxLockResets: cfg.maxLockResets ?? 15,
      clearDelay: cfg.clearDelay ?? 220,
      previewCount: cfg.previewCount ?? 5,
      cascade: cfg.cascade ?? true,
      cascadeGravity: cfg.cascadeGravity ?? 90,
      gravityBoost: cfg.gravityBoost ?? 3,
      colorMatch: cfg.colorMatch ?? 8,
      colors: cfg.colors ?? 4,
      garbageEvery: cfg.garbageEvery ?? 8,
      tiltEvery: cfg.tiltEvery ?? 12,
      tiltTurn: cfg.tiltTurn ?? 320,
      beatWindow: cfg.beatWindow ?? 75,
      nudgeTurn: cfg.nudgeTurn ?? 170,
      nudgeHeat: cfg.nudgeHeat ?? 45,
      heatCool: cfg.heatCool ?? 10,
      tiltOutMs: cfg.tiltOutMs ?? 3000,
    };
    this.level = this.config.startLevel;
    this.bag = new SevenBag(this.config.seed);
    this.colorRng = mulberry32(this.config.seed ^ 0x5bd1e995);
    this.garbageRng = mulberry32(this.config.seed ^ 0x2545f491);
    this.garbageIn = this.garbageInterval();
    this.tiltIn = this.config.tiltEvery > 0 ? this.config.tiltEvery : Infinity;
    this.tiltDir = this.garbageRng() < 0.5 ? 'left' : 'right';
    while (this.queue.length < this.config.previewCount) this.enqueue();
  }

  /** Score multiplier from the current groove streak. */
  get grooveMultiplier(): number {
    return 1 + GROOVE_STEP * Math.min(this.groove, MAX_GROOVE);
  }

  /** Total ms of the current tilt: turn, slide, hold, turn back. */
  private get tiltTotal(): number {
    return this.turnMs * 2 + this.tiltSlide + (this.turnMs > 0 ? TILT_HOLD : 0);
  }

  /** 0 = upright, 1 = fully turned; only meaningful in the 'tilting' phase. */
  tiltTurned(): number {
    if (this.phase !== 'tilting') return 0;
    const turn = this.turnMs;
    if (turn <= 0) return 1;
    const e = this.tiltElapsed;
    const back = this.tiltTotal - turn;
    if (e < turn) return e / turn;
    if (e > back) return Math.max(0, 1 - (e - back) / turn);
    return 1;
  }

  /** Cells a same-color group needs to pop at the current level (0 = color match off). */
  get matchSize(): number {
    const m = this.config.colorMatch;
    return m > 0 && this.level >= BIGGER_MATCH_LEVEL ? m + 2 : m;
  }

  /** Colors pieces are dealt from at the current level. */
  get colorCount(): number {
    const extra = this.level >= EXTRA_COLOR_LEVEL ? 1 : 0;
    return Math.min(this.config.colors + extra, MATCH_PALETTE.length);
  }

  /** Pieces between garbage rows at the current level. */
  garbageInterval(): number {
    const every = this.config.garbageEvery;
    // speeds up one piece per level, but never below the floor (or the base, if that's lower)
    return every > 0 ? Math.max(Math.min(every, MIN_GARBAGE_EVERY), every - (this.level - 1)) : Infinity;
  }

  private enqueue(): void {
    const type = this.bag.next();
    this.queue.push(type);
    const n = this.colorCount;
    this.queueColors.push(this.config.colorMatch > 0 ? MATCH_PALETTE[Math.floor(this.colorRng() * n)] : type);
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }

  start(): void {
    if (this.phase !== 'ready') return;
    this.spawn();
  }

  get gravityMs(): number {
    return gravitySeconds(this.level + this.config.gravityBoost) * 1000;
  }

  /** Ghost piece landing position for the active piece. */
  ghostY(): number {
    const p = this.active;
    if (!p) return 0;
    let y = p.y;
    while (this.board.fits(p.type, p.rot, p.x, y + 1)) y++;
    return y;
  }

  /** Cells that would pop if the active piece were hard-dropped now (for aiming feedback). */
  previewPops(): number {
    const p = this.active;
    const min = this.matchSize;
    if (!p || min <= 0 || this.phase !== 'falling') return 0;
    const W = this.board.width;
    const gy = this.ghostY();
    const keys = cellsOf(p.type, p.rot).map(([cx, cy]) => (gy + cy) * W + p.x + cx);
    const grid = this.board.grid;
    for (const k of keys) grid[Math.floor(k / W)][k % W] = p.color ?? p.type;
    const groups = this.board.colorGroups(min).filter((g) => g.some((k) => keys.includes(k)));
    for (const k of keys) grid[Math.floor(k / W)][k % W] = null;
    return groups.reduce((n, g) => n + g.length, 0);
  }

  isGrounded(): boolean {
    const p = this.active;
    return !!p && !this.board.fits(p.type, p.rot, p.x, p.y + 1);
  }

  /** Rows a settled cell is still drawn above its final position while chunks fall. */
  fallOffset(x: number, y: number): number {
    const d = this.drops.get(y * this.board.width + x);
    if (!d) return 0;
    const ms = this.phase === 'tilting' ? Math.max(0, this.tiltElapsed - this.turnMs) : this.settleElapsed;
    const t = ms / 1000;
    return Math.max(0, d - 0.5 * this.config.cascadeGravity * t * t);
  }

  /** Fraction (0-1) of lock delay elapsed; used for the visual "about to lock" cue. */
  lockProgress(): number {
    return this.isGrounded() ? Math.min(1, this.lockTimer / this.config.lockDelay) : 0;
  }

  // ---------------------------------------------------------------- inputs

  moveLeft(): boolean {
    return this.shift(-1);
  }

  moveRight(): boolean {
    return this.shift(1);
  }

  /** Inputs are accepted only while a piece is falling and the machine hasn't tilted out. */
  private get controllable(): boolean {
    return this.phase === 'falling' && !!this.active && this.tiltedFor <= 0;
  }

  /**
   * Nudge the machine: the board turns 90° toward `dir` and everything slides to that wall,
   * then it swings back and settles; play resumes with the same piece. Heats the tilt meter;
   * a nudge that would max it out tilts the machine instead.
   */
  nudge(dir: 'left' | 'right'): boolean {
    if (!this.controllable) return false;
    if (this.heat + this.config.nudgeHeat >= MAX_HEAT) {
      this.tiltOut();
      return false;
    }
    this.heat += this.config.nudgeHeat;
    this.resume = this.active;
    this.active = null;
    this.startTilt(dir, this.config.nudgeTurn, true);
    return true;
  }

  /** Too much nudging: dead controls for a while, a garbage row on the way, meter reset. */
  private tiltOut(): void {
    this.tiltedFor = this.config.tiltOutMs;
    this.heat = 0;
    this.pendingGarbage++;
    this.emit({ type: 'tilted' });
  }

  private shift(dx: number): boolean {
    const p = this.active;
    if (!this.controllable || !p) return false;
    if (!this.board.fits(p.type, p.rot, p.x + dx, p.y)) return false;
    p.x += dx;
    this.lastMoveWasRotate = false;
    this.onSuccessfulMove();
    this.emit({ type: 'move' });
    return true;
  }

  rotateCW(): boolean {
    return this.rotate(1);
  }

  rotateCCW(): boolean {
    return this.rotate(3);
  }

  rotate180(): boolean {
    return this.rotate(2);
  }

  private rotate(delta: 1 | 2 | 3): boolean {
    const p = this.active;
    if (!this.controllable || !p) return false;
    const to = ((p.rot + delta) % 4) as Rotation;
    const kicks = kicksFor(p.type, p.rot, to);
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (this.board.fits(p.type, to, p.x + kx, p.y + ky)) {
        p.rot = to;
        p.x += kx;
        p.y += ky;
        this.lastMoveWasRotate = true;
        this.lastKickIndex = i;
        this.onSuccessfulMove();
        this.emit({ type: 'rotate', tspin: this.detectTSpin() });
        return true;
      }
    }
    return false;
  }

  /** Returns true if the piece moved down one row. */
  softDrop(): boolean {
    const p = this.active;
    if (!this.controllable || !p) return false;
    if (!this.board.fits(p.type, p.rot, p.x, p.y + 1)) return false;
    p.y++;
    this.score += 1;
    this.lastMoveWasRotate = false;
    this.gravityAcc = 0;
    this.noteDescent();
    this.emit({ type: 'softdrop' });
    return true;
  }

  hardDrop(): void {
    const p = this.active;
    if (!this.controllable || !p) return;
    const gy = this.ghostY();
    const distance = gy - p.y;
    p.y = gy;
    this.score += distance * 2;
    if (distance > 0) this.lastMoveWasRotate = false;
    this.emit({ type: 'harddrop', distance });
    this.lockPiece();
  }

  holdPiece(): boolean {
    const p = this.active;
    if (!this.controllable || !p || !this.canHold) return false;
    const prev = this.hold;
    const prevColor = this.holdColor;
    this.hold = p.type;
    this.holdColor = p.color ?? p.type;
    this.canHold = false;
    this.emit({ type: 'hold' });
    this.spawn(prev ?? undefined, prevColor ?? undefined);
    return true;
  }

  // ---------------------------------------------------------------- simulation

  /** Advance the simulation by dt milliseconds. */
  tick(dt: number): void {
    if (this.phase === 'over' || this.phase === 'ready') return;
    this.elapsed += dt;
    this.heat = Math.max(0, this.heat - (this.config.heatCool * dt) / 1000);
    this.tiltedFor = Math.max(0, this.tiltedFor - dt);

    if (this.phase === 'clearing' || this.phase === 'settling' || this.phase === 'tilting') {
      if (this.phase === 'clearing') this.clearTimer -= dt;
      else if (this.phase === 'settling') this.settleElapsed += dt;
      else this.tiltElapsed += dt;
      // zero-length steps resolve immediately, so a whole chain can finish in one tick
      for (;;) {
        if (this.phase === 'clearing' && this.clearTimer <= 0) this.finishClear();
        else if (this.phase === 'settling' && this.settleElapsed >= this.settleTotal) this.finishSettle();
        else if (this.phase === 'tilting' && this.tiltElapsed >= this.tiltTotal) this.finishTilt();
        else break;
      }
      return;
    }

    const p = this.active;
    if (!p) return;

    if (this.isGrounded()) {
      this.gravityAcc = 0;
      this.lockTimer += dt;
      if (this.lockTimer >= this.config.lockDelay) this.lockPiece();
      return;
    }

    this.gravityAcc += dt;
    const g = this.gravityMs;
    while (this.gravityAcc >= g) {
      this.gravityAcc -= g;
      if (this.board.fits(p.type, p.rot, p.x, p.y + 1)) {
        p.y++;
        this.lastMoveWasRotate = false;
        this.noteDescent();
      } else {
        this.gravityAcc = 0;
        break;
      }
    }
  }

  private noteDescent(): void {
    const p = this.active!;
    if (p.y > this.lowestY) {
      this.lowestY = p.y;
      this.lockTimer = 0;
      this.lockResets = 0;
    }
  }

  /** Lock delay "move reset": limited resets while the piece is grounded. */
  private onSuccessfulMove(): void {
    if (this.lockResets < this.config.maxLockResets) {
      this.lockTimer = 0;
      if (this.isGrounded()) this.lockResets++;
    }
  }

  private spawn(forced?: PieceType, forcedColor?: PieceType): void {
    const [type, color] = forced ? [forced, forcedColor ?? forced] : this.dequeue();
    const rot: Rotation = 0;
    const size = type === 'I' ? 4 : type === 'O' ? 2 : 3;
    const x = Math.floor((this.board.width - size) / 2);
    const y = HIDDEN_ROWS - (type === 'I' ? 1 : 0);
    const piece: ActivePiece = { type, rot, x, y, color };
    this.active = piece;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = y;
    this.lastMoveWasRotate = false;
    this.lastKickIndex = 0;

    // Block out: try one row up before declaring game over.
    if (!this.board.fits(type, rot, x, y)) {
      if (this.board.fits(type, rot, x, y - 1)) {
        piece.y = y - 1;
      } else {
        this.phase = 'over';
        this.emit({ type: 'gameover' });
        return;
      }
    }
    this.phase = 'falling';
    this.emit({ type: 'spawn', piece });
  }

  private dequeue(): [PieceType, PieceType] {
    const t = this.queue.shift()!;
    const c = this.queueColors.shift()!;
    this.enqueue();
    return [t, c];
  }

  private detectTSpin(): TSpinKind {
    const p = this.active;
    if (!p || p.type !== 'T' || !this.lastMoveWasRotate) return 'none';
    const b = this.board;
    const tl = b.isBlocked(p.x, p.y);
    const tr = b.isBlocked(p.x + 2, p.y);
    const bl = b.isBlocked(p.x, p.y + 2);
    const br = b.isBlocked(p.x + 2, p.y + 2);
    const filled = [tl, tr, bl, br].filter(Boolean).length;
    if (filled < 3) return 'none';
    // "Front" corners are the two on the side the T points toward.
    const front: [boolean, boolean] =
      p.rot === 0 ? [tl, tr] : p.rot === 1 ? [tr, br] : p.rot === 2 ? [bl, br] : [tl, bl];
    if ((front[0] && front[1]) || this.lastKickIndex === 4) return 'full';
    return 'mini';
  }

  private lockPiece(): void {
    const p = this.active;
    if (!p) return;
    const tspin = this.detectTSpin();
    this.board.lock(p);
    this.piecesPlaced++;
    if (--this.garbageIn <= 0) {
      this.pendingGarbage++;
      this.garbageIn = this.garbageInterval();
    }
    if (--this.tiltIn <= 0) {
      this.pendingTilt = true;
      this.tiltIn = this.config.tiltEvery;
    }
    this.emit({ type: 'lock', piece: p });
    this.judgeBeat();

    // Lock out: piece locked entirely inside the hidden buffer.
    const allHidden = cellsOf(p.type, p.rot).every(([, cy]) => p.y + cy < HIDDEN_ROWS);
    if (allHidden) {
      this.active = null;
      this.phase = 'over';
      this.emit({ type: 'gameover' });
      return;
    }

    const rows = this.board.fullRows();
    const pops = this.findPops();
    const junk = this.brokenGarbage(pops);
    this.active = null;
    this.canHold = true;

    if (rows.length === 0 && pops.length === 0 && tspin === 'none') {
      this.combo = -1;
      this.nextPiece();
      return;
    }

    this.chain = rows.length > 0 || pops.length > 0 ? 1 : 0;

    this.scoreClear(rows, tspin, pops, junk);
    if (rows.length > 0 || pops.length > 0) this.startClearing(rows, pops, junk);
    else this.nextPiece();
  }

  /** Locks on the beat build groove; a lock off the beat drops it. */
  private judgeBeat(): void {
    const offset = this.beatClock?.() ?? null;
    if (offset === null) return;
    const onBeat = Math.abs(offset) <= this.config.beatWindow;
    this.groove = onBeat ? this.groove + 1 : 0;
    this.bestGroove = Math.max(this.bestGroove, this.groove);
    this.emit({ type: 'beat', onBeat, groove: this.groove, offset });
  }

  /** Tilt if one came due, otherwise raise any due garbage, then spawn. */
  private nextPiece(): void {
    if (this.pendingTilt && !this.resume) {
      this.pendingTilt = false;
      const dir = this.tiltDir;
      this.tiltDir = this.garbageRng() < 0.5 ? 'left' : 'right';
      this.startTilt(dir, this.config.tiltTurn, false);
      return;
    }
    if (this.pendingGarbage > 0) {
      const n = this.pendingGarbage;
      this.pendingGarbage = 0;
      const holes = Array.from({ length: n }, () => Math.floor(this.garbageRng() * this.board.width));
      if (!this.board.raise(holes)) {
        this.phase = 'over';
        this.emit({ type: 'gameover' });
        return;
      }
      this.emit({ type: 'garbage', rows: n });
    }
    if (this.resume) this.resumePiece();
    else this.spawn();
  }

  /** Back to the piece that was falling when the player nudged, lifted clear if the stack moved under it. */
  private resumePiece(): void {
    const p = this.resume!;
    this.resume = null;
    while (!this.board.fits(p.type, p.rot, p.x, p.y) && p.y > 0) p.y--;
    if (!this.board.fits(p.type, p.rot, p.x, p.y)) {
      this.phase = 'over';
      this.emit({ type: 'gameover' });
      return;
    }
    this.active = p;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lowestY = p.y;
    this.lastMoveWasRotate = false;
    this.phase = 'falling';
  }

  /** The board turns 90°: every loose chunk slides to the side wall. */
  private startTilt(dir: 'left' | 'right', turnMs: number, nudge: boolean): void {
    this.turnMs = turnMs;
    this.drops = this.board.settle(dir);
    this.fallDir = dir;
    let maxSlide = 0;
    for (const d of this.drops.values()) maxSlide = Math.max(maxSlide, d);
    const g = this.config.cascadeGravity;
    this.tiltSlide = maxSlide > 0 && g > 0 ? Math.sqrt((2 * maxSlide) / g) * 1000 : 0;
    this.tiltElapsed = 0;
    this.chain = 1; // whatever the tilt lines up scores as a chain
    this.phase = 'tilting';
    this.emit({ type: 'tilt', dir, nudge });
  }

  /** The board turns back upright and everything falls to the floor again. */
  private finishTilt(): void {
    this.drops = this.board.settle('down');
    this.fallDir = 'down';
    let maxDrop = 0;
    for (const d of this.drops.values()) maxDrop = Math.max(maxDrop, d);
    const g = this.config.cascadeGravity;
    this.settleElapsed = 0;
    this.settleTotal = maxDrop > 0 && g > 0 ? Math.sqrt((2 * maxDrop) / g) * 1000 + SETTLE_PAUSE : 0;
    this.phase = 'settling';
    if (maxDrop > 0) this.emit({ type: 'cascade', chain: this.chain, maxDrop });
  }

  private findPops(): number[][] {
    const min = this.matchSize;
    return min > 0 ? this.board.colorGroups(min) : [];
  }

  /** Garbage cells touching any popping group. */
  private brokenGarbage(pops: number[][]): number[] {
    const W = this.board.width;
    const H = this.board.height;
    const out = new Set<number>();
    for (const k of pops.flat()) {
      const x = k % W;
      const y = Math.floor(k / W);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && this.board.grid[ny][nx] === GARBAGE) out.add(ny * W + nx);
      }
    }
    return [...out];
  }

  private startClearing(rows: number[], pops: number[][], junk: number[] = []): void {
    const W = this.board.width;
    this.clearingRows = rows;
    this.clearingCells = new Set([...pops.flat(), ...junk]);
    for (const y of rows) for (let x = 0; x < W; x++) this.clearingCells.add(y * W + x);
    this.clearTimer = this.config.clearDelay;
    this.phase = 'clearing';
  }

  private scoreClear(rows: number[], tspin: TSpinKind, pops: number[][] = [], junk: number[] = []): void {
    const count = rows.length;
    const difficult = count === 4 || (tspin !== 'none' && count > 0);
    // Chain clears happen on their own: they double per step and leave b2b/combo alone.
    const chained = this.chain > 1;

    let points = BASE_POINTS[`${count}-${tspin}`] ?? 0;
    let b2bApplied = false;
    if (chained) {
      points *= 2 ** (this.chain - 1);
    } else if (difficult) {
      this.b2b++;
      if (this.b2b > 0) {
        points = Math.floor(points * 1.5);
        b2bApplied = true;
      }
    } else if (count > 0) {
      this.b2b = -1;
    }

    const cleared = count > 0 || pops.length > 0;
    if (!chained) {
      if (cleared) this.combo++;
      else this.combo = -1;
    }
    const comboPoints = this.combo > 0 && !chained ? 50 * this.combo : 0;

    // Color pops: per cell, plus a bonus for oversized groups; doubled per chain step like lines.
    const W = this.board.width;
    const min = this.matchSize;
    const poppedCells = pops.reduce((n, g) => n + g.length, 0);
    let popPoints = pops.reduce((n, g) => n + g.length * POP_POINTS + (g.length - min) * POP_BONUS, 0);
    popPoints += junk.length * GARBAGE_POINTS;
    if (chained) popPoints *= 2 ** (this.chain - 1);
    this.popped += poppedCells;

    // Perfect clear: the board will be empty once these rows and groups are removed.
    const popSet = new Set([...pops.flat(), ...junk]);
    const perfect =
      cleared &&
      this.board.grid.every((row, y) => rows.includes(y) || row.every((c, x) => c === null || popSet.has(y * W + x)));
    const pcBonus = perfect ? [800, 800, 1200, 1800, 2000][count] : 0;

    const total = Math.round((points + comboPoints + pcBonus + popPoints) * this.level * this.grooveMultiplier);
    this.score += total;

    const parts: string[] = [];
    if (chained) parts.push(`${this.chain} CHAIN`);
    if (poppedCells > 0) parts.push(`${poppedCells} MATCH`);
    if (tspin === 'full') parts.push('T-SPIN');
    if (tspin === 'mini') parts.push('MINI T-SPIN');
    if (count > 0) parts.push(CLEAR_NAMES[count]);
    if (perfect) parts.push('PERFECT CLEAR');

    this.emit({
      type: 'clear',
      clear: {
        rows,
        count,
        tspin,
        b2b: b2bApplied,
        combo: this.combo,
        perfect,
        points: total,
        label: parts.join(' '),
        chain: this.chain,
        garbage: junk.map((k) => [k % W, Math.floor(k / W)] as [number, number]),
        pops: pops.map((g) => ({
          color: this.board.grid[Math.floor(g[0] / W)][g[0] % W] as PieceType, // groups never include garbage
          cells: g.map((k) => [k % W, Math.floor(k / W)] as [number, number]),
        })),
      },
    });

    this.lines += count;
    this.progress += count + pops.length;
    const newLevel = this.config.startLevel + Math.floor(this.progress / LINES_PER_LEVEL);
    if (newLevel > this.level) {
      this.level = newLevel;
      this.emit({ type: 'levelup', level: newLevel });
    }
  }

  private finishClear(): void {
    const rows = this.clearingRows;
    const cells = this.clearingCells;
    this.clearingRows = [];
    this.clearingCells = new Set();
    if (!this.config.cascade) {
      this.board.blankCells(cells);
      this.board.removeRows(rows);
      this.chain = 0;
      this.nextPiece();
      return;
    }
    this.board.blankCells(cells);
    this.drops = this.board.settle();
    let maxDrop = 0;
    for (const d of this.drops.values()) maxDrop = Math.max(maxDrop, d);
    const g = this.config.cascadeGravity;
    this.settleElapsed = 0;
    this.settleTotal = maxDrop > 0 && g > 0 ? Math.sqrt((2 * maxDrop) / g) * 1000 + SETTLE_PAUSE : 0;
    this.phase = 'settling';
    if (maxDrop > 0) this.emit({ type: 'cascade', chain: this.chain, maxDrop });
  }

  private finishSettle(): void {
    const W = this.board.width;
    const landed = [...this.drops.keys()].map((k) => [k % W, Math.floor(k / W)] as [number, number]);
    this.drops = new Map();
    if (landed.length) this.emit({ type: 'landed', cells: landed, chain: this.chain });

    const rows = this.board.fullRows();
    const pops = this.findPops();
    if (rows.length > 0 || pops.length > 0) {
      const junk = this.brokenGarbage(pops);
      this.chain++;
      this.maxChain = Math.max(this.maxChain, this.chain);
      this.scoreClear(rows, 'none', pops, junk);
      this.startClearing(rows, pops, junk);
      return;
    }
    this.chain = 0;
    this.nextPiece();
  }
}
