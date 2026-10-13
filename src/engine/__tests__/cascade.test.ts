import { describe, expect, it } from 'vitest';
import { Board, BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS } from '../board';
import { Game, type GameConfig, type GameEvent } from '../game';

const H = BOARD_HEIGHT;

function newGame(cfg: GameConfig = {}) {
  const g = new Game({ seed: 1, clearDelay: 0, cascadeGravity: 0, tiltEvery: 0, colorMatch: 0, garbageEvery: 0, ...cfg });
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

function clears(events: GameEvent[]) {
  return events.flatMap((e) => (e.type === 'clear' ? [e.clear] : []));
}

/**
 * Two-step chain setup (bottom of board):
 *   H-4:  . . . . . . . . . X   <- loose bar in column 9
 *   H-3:  . . . . . . . . . X
 *   H-2:  . . . . X X X X X X   <- a flat I in columns 0-3 completes this row
 *   H-1:  X X X X X X X X X .   <- hole that the bar falls into
 */
function buildChain(g: Game) {
  for (let x = 0; x < 9; x++) g.board.grid[H - 1][x] = 'J';
  for (let x = 4; x < BOARD_WIDTH; x++) g.board.grid[H - 2][x] = 'L';
  g.board.grid[H - 3][9] = 'S';
  g.board.grid[H - 4][9] = 'S';
  g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1 };
  g.hardDrop();
}

describe('Board.settle', () => {
  it('drops each connected chunk rigidly until any of its cells is supported', () => {
    const b = new Board();
    b.grid[H - 1][0] = 'J'; // floor support under column 0
    // chunk: (0,H-3) (1,H-3) (1,H-4) — column 1 has nothing below it
    b.grid[H - 3][0] = 'T';
    b.grid[H - 3][1] = 'T';
    b.grid[H - 4][1] = 'T';
    const drops = b.settle();
    expect(b.grid[H - 2][0]).toBe('T');
    expect(b.grid[H - 2][1]).toBe('T');
    expect(b.grid[H - 3][1]).toBe('T');
    expect(b.grid[H - 1][1]).toBeNull(); // did not split off and fall to the floor
    expect([...drops.values()]).toEqual([1, 1, 1]);
  });

  it('lets a chunk fall onto another chunk that fell first', () => {
    const b = new Board();
    b.grid[H - 5][3] = 'I';
    b.grid[H - 8][3] = 'O';
    const drops = b.settle();
    expect(b.grid[H - 1][3]).toBe('I');
    expect(b.grid[H - 2][3]).toBe('O');
    expect(drops.get((H - 2) * BOARD_WIDTH + 3)).toBe(6);
  });
});

describe('piece identity', () => {
  it('only holds cells of the same piece together', () => {
    const b = new Board();
    b.grid[H - 1][0] = 'J'; // floor support under column 0
    b.grid[H - 2][0] = 'O'; // piece 1 rests on the support...
    b.grid[H - 2][1] = 'O';
    b.ids[H - 2][0] = b.ids[H - 2][1] = 1;
    b.grid[H - 2][2] = 'T'; // ...piece 2 merely touches it, with nothing underneath
    b.ids[H - 2][2] = 2;
    b.settle();
    expect(b.grid[H - 2][1]).toBe('O');
    expect(b.grid[H - 2][2]).toBeNull();
    expect(b.grid[H - 1][2]).toBe('T');
  });

  it('a locked piece standing over a hole drops into it once its support row clears', () => {
    const { g, events } = newGame();
    // H-1: hole in column 9.  H-2: full except columns 0-3 (filled by a flat I later).
    for (let x = 0; x < 9; x++) g.board.grid[H - 1][x] = 'J';
    for (let x = 4; x < BOARD_WIDTH; x++) g.board.grid[H - 2][x] = 'L';
    g.active = { type: 'I', rot: 1, x: 7, y: HIDDEN_ROWS }; // vertical I in column 9
    g.hardDrop(); // stands on row H-2, rows H-6..H-3
    expect(g.board.grid[H - 3][9]).toBe('I');
    g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1 };
    g.hardDrop(); // completes row H-2
    g.tick(1);
    expect(clears(events).map((c) => c.chain)).toEqual([1, 2]); // the I fell in and finished row H-1
    expect(g.board.grid[H - 1][9]).toBe('I');
    expect(g.board.grid[H - 3][9]).toBe('I');
    expect(g.board.grid[H - 4][9]).toBeNull();
  });
});

describe('cascade chains', () => {
  it('a falling chunk completes another line and scores a doubled chain clear', () => {
    const { g, events } = newGame();
    buildChain(g);
    g.tick(1);
    const [first, second] = clears(events);
    expect(first).toMatchObject({ chain: 1, count: 1, label: 'SINGLE', points: 100 });
    expect(second).toMatchObject({ chain: 2, count: 1, label: '2 CHAIN SINGLE', points: 200 });
    expect(events.some((e) => e.type === 'cascade')).toBe(true);
    expect(g.lines).toBe(2);
    expect(g.maxChain).toBe(2);
    expect(g.chain).toBe(0);
    expect(g.phase).toBe('falling');
    // only the top cell of the bar survives, resting on the floor
    expect(g.board.grid[H - 1][9]).toBe('S');
    expect(g.board.grid.flat().filter(Boolean)).toHaveLength(1);
  });

  it('chain clears do not advance the combo', () => {
    const { g, events } = newGame();
    buildChain(g);
    g.tick(1);
    expect(clears(events).map((c) => c.combo)).toEqual([0, 0]);
    expect(g.combo).toBe(0);
  });

  it('classic mode shifts rows down without chains', () => {
    const { g, events } = newGame({ cascade: false });
    buildChain(g);
    g.tick(1);
    expect(clears(events)).toHaveLength(1);
    expect(g.board.grid[H - 1][9]).toBeNull();
    expect(g.board.grid[H - 2][9]).toBe('S');
  });

  it('animates falling chunks under gravity before spawning the next piece', () => {
    const { g } = newGame({ cascadeGravity: 160 });
    buildChain(g);
    g.tick(1); // clear done; bar starts falling 2 rows
    expect(g.phase).toBe('settling');
    expect(g.fallOffset(9, H - 1)).toBeCloseTo(2, 1);
    expect(g.active).toBeNull();
    g.tick(60);
    const mid = g.fallOffset(9, H - 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(2);
    g.tick(1000); // land, chain clear, settle again
    g.tick(1000);
    expect(g.phase).toBe('falling');
    expect(g.fallOffset(9, H - 1)).toBe(0);
  });
});
