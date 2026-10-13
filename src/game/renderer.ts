import { BOARD_WIDTH, GARBAGE, HIDDEN_ROWS, VISIBLE_HEIGHT, type ActivePiece, type Cell } from '../engine/board';
import { DANGER_HEAT, GROOVE_STEP, MATCH_PALETTE, MAX_GROOVE, MAX_HEAT, type ClearEvent, type Game } from '../engine/game';
import { cellsOf, COLORS, PIECE_TYPES, type PieceType } from '../engine/pieces';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatText {
  text: string;
  sub?: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: string;
  scale: number;
}

interface LockFlash {
  cells: [number, number][];
  color: string;
  life: number;
}

export interface Layout {
  cell: number;
  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;
  holdX: number;
  nextX: number;
  sideW: number;
}

/** Screen space (CSS px) covered by on-screen controls that the layout must avoid. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const GARBAGE_COLOR = '#5d6478';

/** Vertical spacing of stats-panel rows, in cells (nine rows fit the panel). */
const STAT_ROW = 1.62;

/** Callout color by chain depth (index = chain). */
const CHAIN_COLORS = ['#ffffff', '#ffffff', '#00f0ff', '#47ff7a', '#ffe14d', '#ff9a3d', '#ff4d6d', '#c85cff'];

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
const DISPLAY = '"Orbitron", "Inter", system-ui, sans-serif';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  layout: Layout = { cell: 24, boardX: 0, boardY: 0, boardW: 0, boardH: 0, holdX: 0, nextX: 0, sideW: 0 };
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** On-screen touch controls are showing: hide keyboard hints. */
  touchMode = false;
  private sprites = new Map<string, HTMLCanvasElement>();
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private flashes: LockFlash[] = [];
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private hue = 200;
  private hueTarget = 200;
  private time = 0;
  private clearFlash = 0;
  private bgPulse = 0;
  private garbageFlash = 0;
  private beatPulse = 0;
  /** rotation sign of the last tilt, kept while the board turns back upright */
  private lastTilt = 1;
  private stars: { x: number; y: number; s: number; v: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    for (let i = 0; i < 90; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), s: Math.random() * 1.5 + 0.4, v: Math.random() * 0.02 + 0.005 });
    }
  }

  get cellSize() {
    return this.layout.cell;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const portrait = this.w < this.h * 0.9;
    const { top, right, bottom, left } = this.insets;
    const padded = top + right + bottom + left > 0;
    const areaW = this.w - left - right;
    const areaH = this.h - top - bottom;
    const sideCells = portrait ? 4.2 : 6;
    const availH = areaH - (padded ? 24 : portrait ? 120 : 80);
    const availW = areaW - (padded ? 12 : 24);
    const cell = Math.floor(Math.min(availH / (VISIBLE_HEIGHT + 1.2), availW / (BOARD_WIDTH + sideCells * 2 + 1.5)));
    const boardW = cell * BOARD_WIDTH;
    const boardH = cell * VISIBLE_HEIGHT;
    const sideW = cell * sideCells;
    const totalW = boardW + sideW * 2 + cell;
    const x0 = left + (areaW - totalW) / 2;
    this.layout = {
      cell,
      boardX: x0 + sideW + cell * 0.5,
      boardY: top + (areaH - boardH) / 2 + (portrait && !padded ? 10 : 0),
      boardW,
      boardH,
      holdX: x0,
      nextX: x0 + sideW + cell + boardW,
      sideW,
    };
    this.sprites.clear();
  }

  setInsets(insets: Insets): void {
    const i = this.insets;
    if (i.top === insets.top && i.right === insets.right && i.bottom === insets.bottom && i.left === insets.left) return;
    this.insets = insets;
    this.resize();
  }

  // ------------------------------------------------------------------ effects API

  onLock(piece: ActivePiece): void {
    const cells = cellsOf(piece.type, piece.rot).map(([cx, cy]) => [piece.x + cx, piece.y + cy] as [number, number]);
    this.flashes.push({ cells, color: COLORS[piece.color ?? piece.type], life: 1 });
    this.shake = Math.max(this.shake, 2);
  }

  onHardDrop(piece: ActivePiece, distance: number): void {
    const { cell, boardX, boardY } = this.layout;
    this.shake = Math.max(this.shake, 3 + Math.min(distance, 15) * 0.3);
    for (const [cx, cy] of cellsOf(piece.type, piece.rot)) {
      const x = boardX + (piece.x + cx + 0.5) * cell;
      const y = boardY + (piece.y + cy - HIDDEN_ROWS + 1) * cell;
      for (let i = 0; i < 3; i++) {
        this.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 80,
          vy: -Math.random() * 120 - 30,
          life: 0.35,
          maxLife: 0.35,
          size: cell * 0.12,
          color: COLORS[piece.color ?? piece.type],
        });
      }
    }
  }

  onClear(c: ClearEvent, level: number): void {
    const { cell, boardX, boardY, boardW } = this.layout;
    const rows = c.rows;
    const popCells = c.pops.flatMap((p) => p.cells);
    const topRow = Math.min(...rows, ...popCells.map(([, y]) => y));
    for (const p of c.pops) this.popBurst(p.cells, COLORS[p.color]);
    if (c.garbage.length) this.popBurst(c.garbage, GARBAGE_COLOR);
    if (c.chain >= 2) {
      this.onChain(rows, topRow, c.chain, c.points, c.perfect);
      return;
    }
    const tspin = c.tspin !== 'none';
    const big = rows.length === 4 || tspin || c.perfect || popCells.length >= 12;
    this.shake = Math.max(this.shake, big ? 9 : 3 + rows.length + popCells.length / 4);
    this.clearFlash = big ? 1 : 0.5;
    if (rows.length) this.burst(rows, 40);

    const cx = boardX + boardW / 2;
    const cy = boardY + (topRow - HIDDEN_ROWS) * cell - cell * 0.5;
    const main = c.perfect ? 'PERFECT CLEAR' : c.label;
    const parts: string[] = [];
    if (c.b2b) parts.push('BACK-TO-BACK');
    if (c.combo > 0) parts.push(`${c.combo} COMBO`);
    if (c.perfect && c.label && c.label !== 'PERFECT CLEAR') parts.push(c.label.replace(' PERFECT CLEAR', ''));
    const color = c.perfect
      ? '#ffe14d'
      : tspin
        ? COLORS.T
        : rows.length === 4
          ? COLORS.I
          : c.pops.length
            ? COLORS[c.pops[0].color]
            : '#ffffff';
    this.texts.push({
      text: main,
      sub: parts.length ? parts.join(' · ') : `+${c.points.toLocaleString()}`,
      x: cx,
      y: Math.max(cy, boardY + cell * 3),
      life: big ? 1.6 : 1.1,
      maxLife: big ? 1.6 : 1.1,
      color,
      scale: big ? 1.35 : 1,
    });
    if (parts.length) {
      this.texts.push({
        text: `+${c.points.toLocaleString()}`,
        x: cx,
        y: Math.max(cy, boardY + cell * 3) + cell * 2.4,
        life: 1.2,
        maxLife: 1.2,
        color: '#ffffff',
        scale: 0.7,
      });
    }
    this.hueTarget = (this.hueTarget + (big ? 60 : 20) + level * 3) % 360;
    this.bgPulse = 1;
  }

  /** Popped color group: a burst of its own color from every cell. */
  private popBurst(cells: [number, number][], color: string): void {
    const { cell, boardX, boardY } = this.layout;
    for (const [x, y] of cells) {
      const px = boardX + (x + 0.5) * cell;
      const py = boardY + (y - HIDDEN_ROWS + 0.5) * cell;
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 80 + Math.random() * 260;
        this.particles.push({
          x: px,
          y: py,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 60,
          life: 0.5 + Math.random() * 0.5,
          maxLife: 1,
          size: cell * (0.1 + Math.random() * 0.16),
          color: Math.random() < 0.25 ? '#ffffff' : color,
        });
      }
    }
  }

  /** Clear made by cascading blocks: escalating callout, bigger burst, hue jump. */
  private onChain(rows: number[], topRow: number, chain: number, points: number, perfect: boolean): void {
    const { cell, boardX, boardY, boardW } = this.layout;
    const color = CHAIN_COLORS[Math.min(chain, CHAIN_COLORS.length - 1)];
    this.shake = Math.max(this.shake, 6 + chain * 2);
    this.clearFlash = 1;
    if (rows.length) this.burst(rows, 40 + chain * 20, color);
    for (const t of this.texts) t.life = Math.min(t.life, 0.15); // the chain callout supersedes earlier ones
    const y = Math.max(boardY + (topRow - HIDDEN_ROWS) * cell - cell * 0.5, boardY + cell * 3);
    this.texts.push({
      text: `${chain} CHAIN${'!'.repeat(Math.min(chain - 1, 3))}`,
      sub: `×${2 ** (chain - 1)}  +${points.toLocaleString()}${perfect ? '  PERFECT CLEAR' : ''}`,
      x: boardX + boardW / 2,
      y,
      life: 1.6,
      maxLife: 1.6,
      color,
      scale: Math.min(1.9, 1.15 + chain * 0.12),
    });
    this.hueTarget = (this.hueTarget + 50 + chain * 25) % 360;
    this.bgPulse = 1;
  }

  /** The stack starts crumbling after a clear. */
  onCascade(maxDrop: number): void {
    this.shake = Math.max(this.shake, 1.5 + Math.min(maxDrop, 10) * 0.25);
  }

  /** Falling chunks hit the stack: dust off the underside of each landed column. */
  onLanded(cells: [number, number][], chain: number): void {
    const { cell, boardX, boardY } = this.layout;
    const landed = new Set(cells.map(([x, y]) => `${x},${y}`));
    this.shake = Math.max(this.shake, 3 + chain);
    for (const [x, y] of cells) {
      if (landed.has(`${x},${y + 1}`)) continue;
      const px = boardX + (x + 0.5) * cell;
      const py = boardY + (y - HIDDEN_ROWS + 1) * cell;
      for (let i = 0; i < 4; i++) {
        this.particles.push({
          x: px + (Math.random() - 0.5) * cell,
          y: py,
          vx: (Math.random() - 0.5) * 140,
          vy: -Math.random() * 90 - 10,
          life: 0.4,
          maxLife: 0.4,
          size: cell * (0.06 + Math.random() * 0.08),
          color: 'rgba(220,230,255,0.9)',
        });
      }
    }
  }

  private burst(rows: number[], perRow: number, tint?: string): void {
    const { cell, boardX, boardY, boardW } = this.layout;
    for (const row of rows) {
      const y = boardY + (row - HIDDEN_ROWS + 0.5) * cell;
      for (let i = 0; i < perRow; i++) {
        const x = boardX + Math.random() * boardW;
        const color = tint && Math.random() < 0.5 ? tint : COLORS[PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)]];
        this.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 420,
          vy: (Math.random() - 0.6) * 380,
          life: 0.6 + Math.random() * 0.5,
          maxLife: 1,
          size: cell * (0.08 + Math.random() * 0.18),
          color: Math.random() < 0.3 ? '#ffffff' : color,
        });
      }
    }
  }

  onLevelUp(level: number): void {
    const { boardX, boardY, boardW, boardH } = this.layout;
    this.texts.push({
      text: `LEVEL ${level}`,
      x: boardX + boardW / 2,
      y: boardY + boardH * 0.6,
      life: 1.5,
      maxLife: 1.5,
      color: '#47ff7a',
      scale: 1.2,
    });
    this.hueTarget = (this.hueTarget + 90) % 360;
    this.bgPulse = 1;
  }

  /** A level brought a new rule (extra color, bigger matches): call it out under LEVEL n. */
  onRuleChange(text: string): void {
    const { boardX, boardY, boardW, boardH, cell } = this.layout;
    this.texts.push({
      text,
      x: boardX + boardW / 2,
      y: boardY + boardH * 0.6 + cell * 1.8,
      life: 2.2,
      maxLife: 2.2,
      color: '#ff9a3d',
      scale: 0.9,
    });
  }

  /** Garbage rows pushed in from the bottom. */
  onGarbage(rows: number): void {
    const { cell, boardX, boardY, boardW, boardH } = this.layout;
    this.shake = Math.max(this.shake, 4 + rows * 2);
    this.garbageFlash = 1;
    for (let i = 0; i < 24 * rows; i++) {
      this.particles.push({
        x: boardX + Math.random() * boardW,
        y: boardY + boardH,
        vx: (Math.random() - 0.5) * 60,
        vy: -60 - Math.random() * 160,
        life: 0.5,
        maxLife: 0.5,
        size: cell * (0.06 + Math.random() * 0.1),
        color: Math.random() < 0.5 ? GARBAGE_COLOR : '#ff4d6d',
      });
    }
  }

  /** A lock judged against the beat. */
  onBeatLock(onBeat: boolean, groove: number, lost: number, piece: ActivePiece | null): void {
    const { cell, boardX, boardY, boardW } = this.layout;
    if (onBeat && piece) {
      // a gold ring off the locked piece
      for (const [cx, cy] of cellsOf(piece.type, piece.rot)) {
        const px = boardX + (piece.x + cx + 0.5) * cell;
        const py = boardY + (piece.y + cy - HIDDEN_ROWS + 0.5) * cell;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + Math.random();
          this.particles.push({
            x: px,
            y: py,
            vx: Math.cos(a) * 120,
            vy: Math.sin(a) * 120,
            life: 0.35,
            maxLife: 0.35,
            size: cell * 0.1,
            color: groove >= MAX_GROOVE ? '#ffe14d' : '#c85cff',
          });
        }
      }
    }
    const milestone = onBeat && (groove === 4 || groove === MAX_GROOVE || (groove > MAX_GROOVE && groove % 8 === 0));
    if (milestone || (!onBeat && lost >= 3)) {
      this.texts.push({
        text: onBeat ? (groove >= MAX_GROOVE ? 'MAX GROOVE' : 'IN THE GROOVE') : 'GROOVE LOST',
        sub: onBeat ? `×${(1 + GROOVE_STEP * Math.min(groove, MAX_GROOVE)).toFixed(2).replace(/\.?0+$/, '')}` : undefined,
        x: boardX + boardW / 2,
        y: boardY + cell * 4,
        life: 1.2,
        maxLife: 1.2,
        color: onBeat ? (groove >= MAX_GROOVE ? '#ffe14d' : '#c85cff') : 'rgba(255,255,255,0.6)',
        scale: 0.8,
      });
    }
  }

  /** The board starts swinging toward `dir`, on its own or because the player nudged it. */
  onTilt(dir: 'left' | 'right', nudge: boolean): void {
    const { boardX, boardY, boardW, boardH } = this.layout;
    this.lastTilt = dir === 'left' ? -1 : 1;
    this.shake = Math.max(this.shake, nudge ? 3 : 5);
    this.hueTarget = (this.hueTarget + (nudge ? 40 : 120)) % 360;
    this.bgPulse = 1;
    const word = nudge ? 'NUDGE' : 'TILT';
    this.texts.push({
      text: dir === 'left' ? `◀ ${word}` : `${word} ▶`,
      x: boardX + boardW / 2,
      y: boardY + boardH * 0.3,
      life: 1.1,
      maxLife: 1.1,
      color: '#00f0ff',
      scale: 1.2,
    });
  }

  /** Nudged too hard: the machine tilts out. */
  onTilted(): void {
    this.shake = 16;
    this.clearFlash = 1;
    this.hueTarget = 350;
    this.bgPulse = 1;
  }

  /** Pinball backglass TILT: flashes over the board while the controls are dead. */
  private drawTiltedSign(game: Game): void {
    if (game.tiltedFor <= 0 || game.phase === 'over') return;
    const ctx = this.ctx;
    const { cell, boardX, boardY, boardW, boardH } = this.layout;
    ctx.fillStyle = 'rgba(40,0,8,0.45)';
    ctx.fillRect(boardX, boardY, boardW, boardH);
    const on = Math.sin(this.time / 70) > -0.3;
    const cx = boardX + boardW / 2;
    const cy = boardY + boardH * 0.42;
    ctx.save();
    ctx.shadowColor = '#ff2a4a';
    ctx.shadowBlur = on ? cell * 1.2 : cell * 0.3;
    this.centeredText('TILT', cx, cy, cell * 2.6, on ? '#ff4d6d' : 'rgba(255,77,109,0.35)', DISPLAY, 900);
    ctx.restore();
    this.centeredText(`${Math.ceil(game.tiltedFor / 1000)}`, cx, cy + cell * 2.2, cell * 0.9, 'rgba(255,255,255,0.8)', DISPLAY, 800);
  }

  /** Chevrons beside the board, on the side it's about to tip toward, for the last two pieces. */
  private drawTiltWarning(game: Game): void {
    if (game.phase === 'over' || !Number.isFinite(game.tiltIn) || game.tiltIn > 2 || game.phase === 'tilting') return;
    const ctx = this.ctx;
    const { cell, boardX, boardY, boardW, boardH } = this.layout;
    const left = game.tiltDir === 'left';
    const x = left ? boardX - cell * 0.55 : boardX + boardW + cell * 0.55;
    const a = (game.tiltIn === 1 ? 0.75 : 0.4) * (0.6 + 0.4 * Math.sin(this.time / 110));
    ctx.save();
    ctx.strokeStyle = `rgba(0,240,255,${a})`;
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.lineCap = 'round';
    const w = cell * 0.22 * (left ? -1 : 1);
    for (let i = 0; i < 4; i++) {
      const cy = boardY + boardH * (0.2 + i * 0.2);
      ctx.beginPath();
      ctx.moveTo(x - w, cy - cell * 0.35);
      ctx.lineTo(x + w, cy);
      ctx.lineTo(x - w, cy + cell * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  onTSpin(): void {
    this.shake = Math.max(this.shake, 2);
  }

  onGameOver(): void {
    this.shake = 14;
    this.hueTarget = 350;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.time += dt;
    const s = dt / 1000;
    this.shake = Math.max(0, this.shake - s * 40);
    this.shakeX = (Math.random() - 0.5) * this.shake * 2;
    this.shakeY = (Math.random() - 0.5) * this.shake * 2;
    this.clearFlash = Math.max(0, this.clearFlash - s * 4);
    this.bgPulse = Math.max(0, this.bgPulse - s * 1.5);
    this.garbageFlash = Math.max(0, this.garbageFlash - s * 2.5);
    let dh = this.hueTarget - this.hue;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    this.hue = (this.hue + dh * Math.min(1, s * 2) + 360) % 360;

    for (const p of this.particles) {
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vy += 700 * s;
      p.vx *= 1 - s * 2;
      p.life -= s;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) t.life -= s;
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const f of this.flashes) f.life -= s * 5;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    for (const st of this.stars) {
      st.y += st.v * s;
      if (st.y > 1) st.y -= 1;
    }
  }

  draw(game: Game, opts: { paused: boolean; highScore: number; beat: number }): void {
    const ctx = this.ctx;
    const { cell, boardX, boardY, boardW, boardH } = this.layout;
    // 1 on each heard beat, fading to 0 before the next
    this.beatPulse = opts.beat < 0 ? 0 : Math.pow(1 - opts.beat, 3);
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(game);
    ctx.translate(this.shakeX, this.shakeY);

    // During a tilt the whole well turns 90° (shrunk to fit), so the side it tips toward is the floor.
    ctx.save();
    const turned = game.tiltTurned();
    if (turned > 0) {
      const e = turned * turned * (3 - 2 * turned); // smoothstep
      const sign = game.fallDir === 'left' ? -1 : game.fallDir === 'right' ? 1 : this.lastTilt;
      const cx = boardX + boardW / 2;
      const cy = boardY + boardH / 2;
      const k = 1 + (boardW / boardH - 1) * e;
      ctx.translate(cx, cy);
      ctx.rotate((sign * e * Math.PI) / 2);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }

    // Board well
    ctx.save();
    const glow = 0.35 + this.bgPulse * 0.4 + this.beatPulse * 0.35 + (game.phase === 'over' ? 0.2 : 0);
    ctx.shadowColor = `hsla(${this.hue}, 90%, 60%, ${glow})`;
    ctx.shadowBlur = cell * 1.6;
    ctx.fillStyle = 'rgba(6, 8, 18, 0.92)';
    this.roundRect(boardX - 4, boardY - 4, boardW + 8, boardH + 8, 10);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = `hsla(${this.hue}, 80%, 65%, 0.55)`;
    ctx.lineWidth = 1.5;
    this.roundRect(boardX - 4, boardY - 4, boardW + 8, boardH + 8, 10);
    ctx.stroke();

    // Grid
    ctx.save();
    ctx.beginPath();
    ctx.rect(boardX, boardY, boardW, boardH);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < BOARD_WIDTH; x++) {
      ctx.moveTo(boardX + x * cell + 0.5, boardY);
      ctx.lineTo(boardX + x * cell + 0.5, boardY + boardH);
    }
    for (let y = 1; y < VISIBLE_HEIGHT; y++) {
      ctx.moveTo(boardX, boardY + y * cell + 0.5);
      ctx.lineTo(boardX + boardW, boardY + y * cell + 0.5);
    }
    ctx.stroke();

    // Locked cells
    const clearing = game.clearingCells;
    const clearT = game.config.clearDelay > 0 ? 1 - game.clearTimer / game.config.clearDelay : 1;
    for (let y = HIDDEN_ROWS - 2; y < game.board.height; y++) {
      const row = game.board.grid[y];
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const c = row[x];
        if (!c) continue;
        const fall = game.phase === 'settling' || game.phase === 'tilting' ? game.fallOffset(x, y) : 0;
        // a cell is drawn back along the direction it's falling, by the distance it has left
        const [fx, fy] = game.fallDir === 'left' ? [-1, 0] : game.fallDir === 'right' ? [1, 0] : [0, 1];
        const px = boardX + (x - fall * fx) * cell;
        const py = boardY + (y - fall * fy - HIDDEN_ROWS) * cell;
        if (fall > 0.05) {
          // motion streak behind a falling cell
          const tail = cell * Math.min(fall, 0.6);
          ctx.globalAlpha = 0.22;
          ctx.drawImage(this.sprite(c, 1.3), px - tail * fx, py - tail * fy, cell, cell);
          ctx.globalAlpha = 1;
        }
        if (clearing.has(y * BOARD_WIDTH + x)) {
          // shrink + whiten as the row disappears
          const k = 1 - clearT;
          ctx.globalAlpha = 0.3 + k * 0.7;
          ctx.fillStyle = '#ffffff';
          const inset = (1 - k) * cell * 0.5;
          ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
          ctx.globalAlpha = 1;
        } else {
          ctx.drawImage(this.sprite(c, game.phase === 'over' ? 0.35 : 1), px, py, cell, cell);
        }
      }
    }

    // Ghost + active
    const p = game.active;
    if (p && game.phase === 'falling') {
      const gy = game.ghostY();
      const pc = COLORS[p.color ?? p.type];
      // a ghost that would set off a color pop glows and pulses
      const willPop = game.previewPops() > 0;
      const pulse = willPop ? 0.5 + 0.5 * Math.sin(this.time / 90) : 0;
      ctx.save();
      if (willPop) {
        ctx.shadowColor = pc;
        ctx.shadowBlur = cell * (0.5 + pulse * 0.6);
      }
      const edge = willPop ? 0.75 + pulse * 0.25 : 0.28;
      ctx.globalAlpha = edge;
      for (const [cx, cy] of cellsOf(p.type, p.rot)) {
        const px = boardX + (p.x + cx) * cell;
        const py = boardY + (gy + cy - HIDDEN_ROWS) * cell;
        ctx.strokeStyle = willPop ? '#ffffff' : pc;
        ctx.lineWidth = willPop ? 2.5 : 2;
        this.roundRect(px + 2, py + 2, cell - 4, cell - 4, 4);
        ctx.stroke();
        ctx.fillStyle = pc;
        ctx.globalAlpha = willPop ? 0.35 + pulse * 0.2 : 0.1;
        ctx.fill();
        ctx.globalAlpha = edge;
      }
      ctx.restore();

      const lp = game.lockProgress();
      const bright = 1 + (lp > 0 ? Math.sin(this.time / 40) * 0.15 * lp + lp * 0.2 : 0);
      for (const [cx, cy] of cellsOf(p.type, p.rot)) {
        const px = boardX + (p.x + cx) * cell;
        const py = boardY + (p.y + cy - HIDDEN_ROWS) * cell;
        ctx.drawImage(this.sprite(p.color ?? p.type, bright), px, py, cell, cell);
      }
    }

    // Lock flashes
    for (const f of this.flashes) {
      ctx.globalAlpha = f.life * 0.6;
      ctx.fillStyle = '#ffffff';
      for (const [x, y] of f.cells) {
        ctx.fillRect(boardX + x * cell, boardY + (y - HIDDEN_ROWS) * cell, cell, cell);
      }
    }
    ctx.globalAlpha = 1;

    // Whole-board flash on big clears
    if (this.clearFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.clearFlash * 0.25})`;
      ctx.fillRect(boardX, boardY, boardW, boardH);
    }

    // Garbage: red wash from the floor when it rises, and a fuse along the bottom edge
    if (this.garbageFlash > 0) {
      const g = ctx.createLinearGradient(0, boardY + boardH, 0, boardY + boardH - cell * 4);
      g.addColorStop(0, `rgba(255,60,80,${0.45 * this.garbageFlash})`);
      g.addColorStop(1, 'rgba(255,60,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(boardX, boardY + boardH - cell * 4, boardW, cell * 4);
    }
    const every = game.garbageInterval();
    if (Number.isFinite(every) && game.phase !== 'over') {
      const k = 1 - game.garbageIn / every;
      const hot = game.garbageIn <= 1;
      const a = hot ? 0.65 + 0.35 * Math.sin(this.time / 70) : 0.55;
      ctx.fillStyle = hot ? `rgba(255,77,109,${a})` : `rgba(255,154,61,${a})`;
      ctx.fillRect(boardX, boardY + boardH - cell * 0.14, boardW * Math.max(0.04, k), cell * 0.14);
    }
    ctx.restore();

    // Danger vignette when the stack is high
    const top = this.stackTop(game);
    if (top < 6 && game.phase !== 'over') {
      const a = (6 - top) / 6;
      const g = ctx.createLinearGradient(0, boardY, 0, boardY + cell * 6);
      g.addColorStop(0, `rgba(255, 40, 70, ${0.35 * a * (0.7 + 0.3 * Math.sin(this.time / 120))})`);
      g.addColorStop(1, 'rgba(255,40,70,0)');
      ctx.fillStyle = g;
      ctx.fillRect(boardX, boardY, boardW, cell * 6);
    }
    ctx.restore(); // end of the tiltable well

    this.drawTiltWarning(game);
    this.drawTiltedSign(game);
    this.drawParticles();
    this.drawSidePanels(game, opts.highScore);
    this.drawTexts();

    if (opts.paused && game.phase !== 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(boardX, boardY, boardW, boardH);
      this.centeredText('PAUSED', boardX + boardW / 2, boardY + boardH / 2, cell * 1.4, '#ffffff', DISPLAY, 900);
      this.centeredText(this.touchMode ? 'tap ❚❚ to resume' : 'ESC / P to resume', boardX + boardW / 2, boardY + boardH / 2 + cell * 1.6, cell * 0.6, 'rgba(255,255,255,0.7)');
    }
    ctx.restore();
  }

  private stackTop(game: Game): number {
    for (let y = HIDDEN_ROWS; y < game.board.height; y++) {
      if (game.board.grid[y].some(Boolean)) return y - HIDDEN_ROWS;
    }
    return VISIBLE_HEIGHT;
  }

  private drawBackground(game: Game): void {
    const ctx = this.ctx;
    const hue = this.hue;
    const pulse = this.bgPulse + this.beatPulse * 0.5;
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, 0, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.8);
    g.addColorStop(0, `hsl(${hue}, 45%, ${10 + pulse * 6}%)`);
    g.addColorStop(0.6, `hsl(${(hue + 40) % 360}, 50%, ${6 + pulse * 3}%)`);
    g.addColorStop(1, '#03040a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // the scenery changes every two levels, like the band does
    const tier = Math.min(3, Math.floor((game.level - 1) / 2));
    if (tier === 1) this.drawSynthwave(hue);
    else if (tier === 2) this.drawAurora(hue);
    else if (tier === 3) this.drawTunnel(hue);
    if (tier !== 3) this.drawStars(game, tier === 1 ? 0.6 : 1);

    // subtle sweeping beams
    ctx.save();
    ctx.globalAlpha = 0.05 + pulse * 0.07;
    for (let i = 0; i < 3; i++) {
      const t = this.time / 6000 + i * 0.33;
      const x = ((t % 1) * 1.4 - 0.2) * this.w;
      const lg = ctx.createLinearGradient(x - 120, 0, x + 120, 0);
      lg.addColorStop(0, 'transparent');
      lg.addColorStop(0.5, `hsl(${(hue + i * 60) % 360}, 90%, 70%)`);
      lg.addColorStop(1, 'transparent');
      ctx.fillStyle = lg;
      ctx.fillRect(x - 120, 0, 240, this.h);
    }
    ctx.restore();
  }

  private drawStars(game: Game, heightFrac: number): void {
    const ctx = this.ctx;
    const speed = 1 + Math.min(game.level, 20) * 0.15;
    for (const st of this.stars) {
      const y = ((st.y * speed) % 1) * this.h * heightFrac;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + st.s * 0.2 + this.beatPulse * 0.15})`;
      ctx.fillRect(st.x * this.w, y, st.s, st.s * (1 + speed * 0.5));
    }
  }

  /** Levels 3-4: a striped sun on the horizon over a grid floor that rolls toward you on the beat. */
  private drawSynthwave(hue: number): void {
    const ctx = this.ctx;
    const { w, h } = this;
    const horizon = h * 0.62;
    const r = Math.min(w, h) * 0.22 * (1 + this.beatPulse * 0.04);
    const sun = ctx.createLinearGradient(0, horizon - r * 1.6, 0, horizon);
    sun.addColorStop(0, '#ffe14d');
    sun.addColorStop(1, '#ff4d9a');
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(w / 2, horizon - r * 0.35, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05050f';
    for (let i = 0; i < 6; i++) {
      const y = horizon - r * 0.35 + r * (0.05 + i * 0.16);
      ctx.fillRect(w / 2 - r, y, r * 2, 2 + i * 1.6);
    }
    ctx.fillStyle = 'rgba(5,4,16,0.85)';
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.strokeStyle = `hsla(${(hue + 300) % 360}, 90%, 65%, ${0.3 + this.beatPulse * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -12; i <= 12; i++) {
      ctx.moveTo(w / 2 + i * w * 0.02, horizon);
      ctx.lineTo(w / 2 + i * w * 0.18, h);
    }
    const scroll = (this.time / 900) % 1;
    for (let i = 0; i < 12; i++) {
      const z = (i + scroll) / 12;
      const y = horizon + (h - horizon) * z * z;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Levels 5-6: aurora ribbons that swell on the beat. */
  private drawAurora(hue: number): void {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const base = h * (0.22 + i * 0.14);
      const amp = h * 0.06 * (1 + this.beatPulse * 0.6);
      const band = h * 0.12;
      const grad = ctx.createLinearGradient(0, base - amp, 0, base + band);
      grad.addColorStop(0, `hsla(${(hue + 90 + i * 40) % 360}, 90%, 60%, 0)`);
      grad.addColorStop(0.4, `hsla(${(hue + 90 + i * 40) % 360}, 90%, 60%, ${0.22 + this.beatPulse * 0.12})`);
      grad.addColorStop(1, `hsla(${(hue + 90 + i * 40) % 360}, 90%, 60%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = base + Math.sin(x * 0.004 + this.time * 0.0005 * (i + 1) + i) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, base + band);
      ctx.lineTo(0, base + band);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Level 7+: a hyperspace tunnel of rings rushing outward, bright on the beat. */
  private drawTunnel(hue: number): void {
    const ctx = this.ctx;
    const { w, h } = this;
    const n = 12;
    const big = Math.max(w, h) * 1.3;
    ctx.save();
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const z = ((this.time / 2400 + i / n) % 1) ** 2;
      const size = big * z;
      ctx.strokeStyle = `hsla(${(hue + i * 30 + this.time / 40) % 360}, 90%, 62%, ${z * (0.35 + this.beatPulse * 0.4)})`;
      this.roundRect(w / 2 - size / 2, h / 2 - size * 0.32, size, size * 0.64, size * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(): void {
    const ctx = this.ctx;
    for (const t of this.texts) {
      const k = t.life / t.maxLife;
      const pop = Math.min(1, (1 - k) * 8);
      const scale = t.scale * (0.6 + pop * 0.4) * (1 + (1 - k) * 0.15);
      const y = t.y - (1 - k) * this.layout.cell * 1.2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 18;
      this.centeredText(t.text, t.x, y, this.layout.cell * 1.05 * scale, t.color, DISPLAY, 900);
      if (t.sub) {
        ctx.shadowBlur = 8;
        this.centeredText(t.sub, t.x, y + this.layout.cell * 1.1 * scale, this.layout.cell * 0.55 * scale, '#ffffff', FONT, 700);
      }
      ctx.restore();
    }
  }

  private drawSidePanels(game: Game, highScore: number): void {
    const ctx = this.ctx;
    const { cell, boardY, holdX, nextX, sideW, boardH } = this.layout;
    const pad = cell * 0.4;

    // HOLD
    this.panel(holdX, boardY, sideW, cell * 4.2);
    this.label('HOLD', holdX + pad, boardY + pad);
    if (game.hold) {
      this.drawMini(game.hold, holdX + sideW / 2, boardY + cell * 2.6, game.canHold ? 1 : 0.35, cell * 0.8, game.holdColor ?? game.hold);
    }

    // Stats
    const statsY = boardY + cell * 4.8;
    this.panel(holdX, statsY, sideW, boardH - cell * 4.8);
    let y = statsY + pad;
    const stat = (name: string, value: string, color = '#ffffff') => {
      this.label(name, holdX + pad, y);
      ctx.font = `800 ${cell * 0.85}px ${DISPLAY}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(value, holdX + pad, y + cell * 0.65);
      y += cell * STAT_ROW;
    };
    stat('SCORE', game.score.toLocaleString());
    stat('BEST', Math.max(highScore, game.score).toLocaleString(), '#ffe14d');
    stat('LEVEL', String(game.level), '#47ff7a');
    if (game.matchSize > 0) {
      // current rule: group size, then a swatch per color being dealt
      const ruleY = y;
      stat('MATCH', String(game.matchSize));
      const dot = cell * 0.36;
      ctx.font = `800 ${cell * 0.85}px ${DISPLAY}`;
      let dx = holdX + pad + ctx.measureText(String(game.matchSize)).width + cell * 0.35;
      for (const c of MATCH_PALETTE.slice(0, game.colorCount)) {
        ctx.drawImage(this.sprite(c, 1, dot), dx, ruleY + cell * 0.65 + (cell * 0.85 - dot) / 2, dot, dot);
        dx += dot * 1.15;
      }
    }
    if (Number.isFinite(game.garbageIn)) {
      stat('RISE IN', String(game.garbageIn), game.garbageIn <= 1 ? '#ff4d6d' : game.garbageIn <= 2 ? '#ff9a3d' : '#ffffff');
    }
    if (Number.isFinite(game.tiltIn)) {
      const arrow = game.tiltDir === 'left' ? '◀' : '▶';
      stat('TILT IN', `${game.tiltIn} ${arrow}`, game.tiltIn <= 2 ? '#00f0ff' : '#ffffff');
    }
    if (game.beatClock) {
      const hot = game.groove >= MAX_GROOVE ? '#ffe14d' : game.groove > 0 ? '#c85cff' : 'rgba(255,255,255,0.55)';
      stat('GROOVE', `×${game.grooveMultiplier.toFixed(2).replace(/\.?0+$/, '')}`, hot);
    }
    {
      // tilt meter: a bar that heats green -> orange -> red, with the pinball DANGER warning
      const danger = game.heat >= DANGER_HEAT;
      const blink = Math.sin(this.time / 90) > 0;
      this.label(game.tiltedFor > 0 ? 'TILTED' : danger && blink ? 'DANGER' : 'NUDGE', holdX + pad, y);
      const bw = sideW - pad * 2;
      const bh = cell * 0.42;
      const by = y + cell * 0.78;
      const k = game.tiltedFor > 0 ? game.tiltedFor / game.config.tiltOutMs : game.heat / MAX_HEAT;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      this.roundRect(holdX + pad, by, bw, bh, bh / 2);
      ctx.fill();
      ctx.fillStyle = game.tiltedFor > 0 ? '#ff4d6d' : danger ? '#ff4d6d' : game.heat > MAX_HEAT * 0.3 ? '#ff9a3d' : '#47ff7a';
      if (k > 0) {
        this.roundRect(holdX + pad, by, Math.max(bh, bw * k), bh, bh / 2);
        ctx.fill();
      }
      y += cell * STAT_ROW;
    }
    if (game.maxChain >= 2) stat('MAX CHAIN', String(game.maxChain), CHAIN_COLORS[Math.min(game.maxChain, CHAIN_COLORS.length - 1)]);

    // NEXT
    const n = game.queue.length;
    this.panel(nextX, boardY, sideW, cell * (1.4 + n * 2.6));
    this.label('NEXT', nextX + pad, boardY + pad);
    game.queue.forEach((t, i) => {
      const color = game.queueColors[i] ?? t;
      this.drawMini(t, nextX + sideW / 2, boardY + cell * (2.6 + i * 2.6), i === 0 ? 1 : 0.85, cell * (i === 0 ? 0.85 : 0.72), color);
    });

    // Controls hint (keyboard only — hidden in portrait/touch layouts)
    if (this.w < this.h * 0.9 || this.touchMode) return;
    const hintY = boardY + boardH - cell * 0.2;
    ctx.font = `500 ${Math.max(10, cell * 0.38)}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const hints = ['← → move', '↑ / X rotate', 'Z ccw', 'F 180', '↓ soft', 'SPACE hard', 'SHIFT / C hold', 'Q / E nudge', 'ESC pause', 'M sfx  N music'];
    hints.forEach((h, i) => ctx.fillText(h, nextX + pad, hintY - (hints.length - 1 - i) * cell * 0.5));
  }

  private drawMini(type: PieceType, cx: number, cy: number, alpha: number, size: number, color: PieceType = type): void {
    const ctx = this.ctx;
    const cells = cellsOf(type, 0);
    const minX = Math.min(...cells.map((c) => c[0]));
    const maxX = Math.max(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    const maxY = Math.max(...cells.map((c) => c[1]));
    const w = (maxX - minX + 1) * size;
    const h = (maxY - minY + 1) * size;
    ctx.save();
    ctx.globalAlpha = alpha;
    const sprite = this.sprite(color, 1, size);
    for (const [x, y] of cells) {
      ctx.drawImage(sprite, cx - w / 2 + (x - minX) * size, cy - h / 2 + (y - minY) * size, size, size);
    }
    ctx.restore();
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8, 10, 24, 0.75)';
    this.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private label(text: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.font = `700 ${Math.max(9, this.layout.cell * 0.45)}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '2px';
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  }

  private centeredText(text: string, x: number, y: number, size: number, color: string, font = FONT, weight = 800): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Pre-rendered glossy block sprite, cached per (type, brightness, size). */
  private sprite(type: Exclude<Cell, null>, brightness = 1, size = this.layout.cell): HTMLCanvasElement {
    const b = Math.round(brightness * 20) / 20;
    const key = `${type}:${b}:${size}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.ceil(size * this.dpr);
    c.height = Math.ceil(size * this.dpr);
    const g = c.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const base = type === GARBAGE ? GARBAGE_COLOR : COLORS[type];
    const [r, gg, bb] = hexToRgb(base);
    const light = `rgb(${Math.min(255, r * b + 80)}, ${Math.min(255, gg * b + 80)}, ${Math.min(255, bb * b + 80)})`;
    const mid = `rgb(${Math.min(255, r * b)}, ${Math.min(255, gg * b)}, ${Math.min(255, bb * b)})`;
    const dark = `rgb(${r * 0.45 * b}, ${gg * 0.45 * b}, ${bb * 0.45 * b})`;
    const m = Math.max(1, size * 0.06);
    const rad = Math.max(2, size * 0.18);

    // glow
    g.shadowColor = base;
    g.shadowBlur = size * 0.35 * b;
    g.fillStyle = mid;
    rr(g, m, m, size - m * 2, size - m * 2, rad);
    g.fill();
    g.shadowBlur = 0;

    // body gradient
    const grad = g.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, light);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, dark);
    g.fillStyle = grad;
    rr(g, m, m, size - m * 2, size - m * 2, rad);
    g.fill();

    // inner bevel
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = Math.max(1, size * 0.05);
    rr(g, m * 2.2, m * 2.2, size - m * 4.4, size - m * 4.4, rad * 0.7);
    g.stroke();

    // specular highlight
    const hg = g.createLinearGradient(0, m, 0, size * 0.5);
    hg.addColorStop(0, 'rgba(255,255,255,0.55)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg;
    rr(g, m * 2.5, m * 2.5, size - m * 5, size * 0.42, rad * 0.6);
    g.fill();

    this.sprites.set(key, c);
    return c;
  }
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
