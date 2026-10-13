import { describe, expect, it } from 'vitest';
import { Board, BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS } from '../board';
import { Game, type GameConfig, type GameEvent } from '../game';

const H = BOARD_HEIGHT;

function newGame(cfg: GameConfig = {}) {
  const g = new Game({ seed: 1, clearDelay: 0, cascadeGravity: 0, tiltTurn: 0, colorMatch: 0, garbageEvery: 0, ...cfg });
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

describe('sideways settle', () => {
  it('slides each piece rigidly to the wall it is tilted toward', () => {
    const b = new Board();
    // an L-ish piece (id 1) floating at columns 5-6, and a blocker (id 2) at column 1 of its top row
    b.grid[H - 2][5] = 'L';
    b.grid[H - 1][5] = 'L';
    b.grid[H - 1][6] = 'L';
    b.ids[H - 2][5] = b.ids[H - 1][5] = b.ids[H - 1][6] = 1;
    b.grid[H - 2][1] = 'T';
    b.ids[H - 2][1] = 2;
    const drops = b.settle('left');
    expect(b.grid[H - 2][0]).toBe('T'); // the blocker slid to the wall first
    // the L stops when its top cell hits the blocker: top at column 1, bottom row at columns 1-2
    expect(b.grid[H - 2][1]).toBe('L');
    expect(b.grid[H - 1][1]).toBe('L');
    expect(b.grid[H - 1][2]).toBe('L');
    expect(drops.get((H - 1) * BOARD_WIDTH + 2)).toBe(4);
  });

  it('slides right too', () => {
    const b = new Board();
    b.grid[H - 1][2] = 'I';
    b.settle('right');
    expect(b.grid[H - 1][BOARD_WIDTH - 1]).toBe('I');
  });
});

describe('tilt', () => {
  it('tilts every N pieces, in the announced direction, and resumes play', () => {
    const { g, events } = newGame({ tiltEvery: 2 });
    const dir = g.tiltDir;
    expect(g.tiltIn).toBe(2);
    g.hardDrop();
    expect(events.some((e) => e.type === 'tilt')).toBe(false);
    g.hardDrop();
    expect(g.phase).toBe('tilting');
    expect(events.find((e) => e.type === 'tilt')).toEqual({ type: 'tilt', dir, nudge: false });
    g.tick(1);
    expect(g.phase).toBe('falling');
    expect(g.tiltIn).toBe(2);
    // everything ended up against the wall it tilted toward
    const wall = dir === 'left' ? 0 : BOARD_WIDTH - 1;
    expect(g.board.grid.some((row) => row[wall] !== null)).toBe(true);
  });

  it('pushes a buried gap out to the far wall, where it is open from above', () => {
    const { g } = newGame({ tiltEvery: 1 });
    // H-2:  . . . C C C . . . .   piece 3 roofs over the gap
    // H-1:  A A A A . B B B B B   pieces 1 and 2, gap at column 4
    const put = (y: number, xs: number[], id: number) => {
      for (const x of xs) {
        g.board.grid[y][x] = 'J';
        g.board.ids[y][x] = id;
      }
    };
    put(H - 1, [0, 1, 2, 3], 1);
    put(H - 1, [5, 6, 7, 8, 9], 2);
    put(H - 2, [3, 4, 5], 3);
    g.tiltDir = 'left';
    g.active = { type: 'O', rot: 0, x: 0, y: HIDDEN_ROWS - 4 }; // triggers the tilt, lands high on the left
    g.hardDrop();
    g.tick(1);
    expect(g.board.grid[H - 1].slice(0, 9).every(Boolean)).toBe(true);
    // the gap is now in column 9, with nothing above it
    expect(g.board.grid.every((row) => row[9] === null)).toBe(true);
  });

  it('can line up a color match by sliding', () => {
    const { g, events } = newGame({ tiltEvery: 1, colorMatch: 8 });
    // two red bars on the floor: columns 0-3 and 6-9, kept apart by the gap at 4-5
    for (const x of [0, 1, 2, 3, 6, 7, 8, 9]) {
      g.board.grid[H - 1][x] = 'Z';
      g.board.ids[H - 1][x] = x < 4 ? 1 : 2;
    }
    g.tiltDir = 'left';
    g.active = { type: 'O', rot: 0, x: 0, y: HIDDEN_ROWS, color: 'J' }; // blue, on the left bar
    g.hardDrop();
    expect(events.some((e) => e.type === 'clear')).toBe(false); // 4 + 4 apart: no match yet
    g.tick(1);
    const clears = events.flatMap((e) => (e.type === 'clear' ? [e.clear] : []));
    expect(clears[0].pops.map((p) => [p.color, p.cells.length])).toEqual([['Z', 8]]);
    expect(clears[0].chain).toBe(2);
  });

  it('turns the board over a timeline: turn, slide, hold, turn back', () => {
    const { g } = newGame({ tiltEvery: 1, tiltTurn: 300, cascadeGravity: 160 });
    g.board.grid[H - 1][8] = 'I';
    g.board.ids[H - 1][8] = 7;
    g.tiltDir = 'left';
    g.active = { type: 'O', rot: 0, x: 0, y: HIDDEN_ROWS };
    g.hardDrop();
    expect(g.phase).toBe('tilting');
    expect(g.tiltTurned()).toBe(0);
    g.tick(150);
    expect(g.tiltTurned()).toBeCloseTo(0.5);
    g.tick(150);
    expect(g.tiltTurned()).toBe(1);
    expect(g.fallOffset(2, H - 1)).toBeGreaterThan(0); // the I is still sliding toward column 2
    g.tick(5000);
    g.tick(5000);
    expect(g.phase).toBe('falling');
    expect(g.tiltTurned()).toBe(0);
  });
});
