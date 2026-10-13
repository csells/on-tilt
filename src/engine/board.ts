import { cellsOf, type PieceType, type Rotation } from './pieces';

export const BOARD_WIDTH = 10;
export const VISIBLE_HEIGHT = 20;
/** Total rows including the hidden buffer above the visible field. Row 0 is the very top. */
export const BOARD_HEIGHT = 40;
export const HIDDEN_ROWS = BOARD_HEIGHT - VISIBLE_HEIGHT;

/** Garbage: rises from the bottom, never color-matches, breaks when a neighbor pops. */
export const GARBAGE = 'X';
export type Cell = PieceType | typeof GARBAGE | null;

/** Which way loose chunks fall: down normally, sideways while the board is tilted. */
export type FallDir = 'down' | 'left' | 'right';
const STEP: Record<FallDir, [number, number]> = { down: [0, 1], left: [-1, 0], right: [1, 0] };

export interface ActivePiece {
  type: PieceType;
  rot: Rotation;
  x: number;
  y: number;
  /** color the piece locks as (a piece type's color key); defaults to its own type */
  color?: PieceType;
}

export class Board {
  readonly width = BOARD_WIDTH;
  readonly height = BOARD_HEIGHT;
  /** grid[y][x], y=0 at top */
  readonly grid: Cell[][];
  /**
   * ids[y][x]: which locked piece a cell came from (0 = unknown, e.g. cells written directly).
   * Cascade chunks only hold together within one piece.
   */
  readonly ids: number[][];
  private nextId = 1;

  constructor() {
    this.grid = Array.from({ length: BOARD_HEIGHT }, () => Array<Cell>(BOARD_WIDTH).fill(null));
    this.ids = Array.from({ length: BOARD_HEIGHT }, () => Array<number>(BOARD_WIDTH).fill(0));
  }

  get(x: number, y: number): Cell {
    return this.grid[y][x];
  }

  /** True if the cell is outside the board or already occupied. */
  isBlocked(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return true;
    return this.grid[y][x] !== null;
  }

  fits(type: PieceType, rot: Rotation, x: number, y: number): boolean {
    for (const [cx, cy] of cellsOf(type, rot)) {
      if (this.isBlocked(x + cx, y + cy)) return false;
    }
    return true;
  }

  lock(p: ActivePiece): void {
    const id = this.nextId++;
    for (const [cx, cy] of cellsOf(p.type, p.rot)) {
      const y = p.y + cy;
      const x = p.x + cx;
      if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
        this.grid[y][x] = p.color ?? p.type;
        this.ids[y][x] = id;
      }
    }
  }

  fullRows(): number[] {
    const rows: number[] = [];
    for (let y = 0; y < this.height; y++) {
      if (this.grid[y].every((c) => c !== null)) rows.push(y);
    }
    return rows;
  }

  removeRows(rows: readonly number[]): void {
    const set = new Set(rows);
    const kept = this.grid.filter((_, y) => !set.has(y));
    const keptIds = this.ids.filter((_, y) => !set.has(y));
    while (kept.length < this.height) {
      kept.unshift(Array<Cell>(this.width).fill(null));
      keptIds.unshift(Array<number>(this.width).fill(0));
    }
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = kept[y];
      this.ids[y] = keptIds[y];
    }
  }

  /** Empty the given rows in place without shifting anything (cascade gravity does the falling). */
  blankRows(rows: readonly number[]): void {
    for (const y of rows) {
      this.grid[y].fill(null);
      this.ids[y].fill(0);
    }
  }

  /**
   * Push everything up and fill the bottom with garbage rows, one per entry in `holes`
   * (the column left open in that row). Returns false, changing nothing, if that would
   * push blocks off the top.
   */
  raise(holes: readonly number[]): boolean {
    const n = holes.length;
    if (this.grid.slice(0, n).some((row) => row.some((c) => c !== null))) return false;
    this.grid.splice(0, n);
    this.ids.splice(0, n);
    for (const hole of holes) {
      this.grid.push(Array.from({ length: this.width }, (_, x) => (x === hole ? null : GARBAGE)));
      const id = this.nextId++;
      this.ids.push(Array.from({ length: this.width }, (_, x) => (x === hole ? 0 : id)));
    }
    return true;
  }

  /** Empty the given cells (keys are `y * width + x`) in place. */
  blankCells(keys: Iterable<number>): void {
    for (const k of keys) {
      const x = k % this.width;
      const y = Math.floor(k / this.width);
      this.grid[y][x] = null;
      this.ids[y][x] = 0;
    }
  }

  /** 4-connected groups of same-colored cells with at least `min` cells, as cell keys. */
  colorGroups(min: number): number[][] {
    const W = this.width;
    const seen = new Set<number>();
    const out: number[][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < W; x++) {
        const c = this.grid[y][x];
        if (c === null || c === GARBAGE || seen.has(y * W + x)) continue;
        const group: number[] = [];
        const stack = [y * W + x];
        seen.add(y * W + x);
        while (stack.length) {
          const k = stack.pop()!;
          group.push(k);
          const cx = k % W;
          const cy = Math.floor(k / W);
          for (const [nx, ny] of [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ]) {
            if (nx < 0 || nx >= W || ny < 0 || ny >= this.height) continue;
            const nk = ny * W + nx;
            if (seen.has(nk) || this.grid[ny][nx] !== c) continue;
            seen.add(nk);
            stack.push(nk);
          }
        }
        if (group.length >= min) out.push(group);
      }
    }
    return out;
  }

  /**
   * Cascade gravity: every 4-connected group of cells from the same piece is a rigid chunk
   * that falls (in `dir`) until it rests on the wall/floor or another chunk. Repeats until
   * nothing moves. Returns how far each moved cell fell, keyed by its final `y * width + x`.
   */
  settle(dir: FallDir = 'down'): Map<number, number> {
    const W = this.width;
    const [sx, sy] = STEP[dir];
    const fell: number[][] = this.grid.map((row) => row.map(() => 0));
    // chunks nearest the destination wall go first, so the ones behind them see their final positions
    const lead = (c: [number, number][]) => Math.max(...c.map(([x, y]) => x * sx + y * sy));
    let moved = true;
    while (moved) {
      moved = false;
      const chunks = this.chunks().sort((a, b) => lead(b) - lead(a));
      for (const chunk of chunks) {
        const own = new Set(chunk.map(([x, y]) => y * W + x));
        const free = (x: number, y: number) =>
          x >= 0 && x < W && y < this.height && (this.grid[y][x] === null || own.has(y * W + x));
        let d = 0;
        while (chunk.every(([x, y]) => free(x + (d + 1) * sx, y + (d + 1) * sy))) d++;
        if (d === 0) continue;
        const cells = chunk.map(([x, y]) => ({ x, y, c: this.grid[y][x], id: this.ids[y][x], f: fell[y][x] }));
        for (const { x, y } of cells) {
          this.grid[y][x] = null;
          this.ids[y][x] = 0;
          fell[y][x] = 0;
        }
        for (const { x, y, c, id, f } of cells) {
          const nx = x + d * sx;
          const ny = y + d * sy;
          this.grid[ny][nx] = c;
          this.ids[ny][nx] = id;
          fell[ny][nx] = f + d;
        }
        moved = true;
      }
    }
    const drops = new Map<number, number>();
    fell.forEach((row, y) => row.forEach((f, x) => f > 0 && drops.set(y * W + x, f)));
    return drops;
  }

  /** 4-connected groups of occupied cells sharing a piece id, as [x, y] lists. */
  private chunks(): [number, number][][] {
    const seen = new Set<number>();
    const out: [number, number][][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x] === null || seen.has(y * this.width + x)) continue;
        const chunk: [number, number][] = [];
        const stack: [number, number][] = [[x, y]];
        seen.add(y * this.width + x);
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          const id = this.ids[cy][cx];
          chunk.push([cx, cy]);
          for (const [nx, ny] of [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ]) {
            const k = ny * this.width + nx;
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
            if (this.grid[ny][nx] === null || seen.has(k) || this.ids[ny][nx] !== id) continue;
            seen.add(k);
            stack.push([nx, ny]);
          }
        }
        out.push(chunk);
      }
    }
    return out;
  }

  isEmpty(): boolean {
    return this.grid.every((row) => row.every((c) => c === null));
  }

  clear(): void {
    for (const row of this.grid) row.fill(null);
    for (const row of this.ids) row.fill(0);
  }
}
