import { describe, expect, it } from 'vitest';
import { Board, BOARD_HEIGHT, HIDDEN_ROWS } from '../board';
import { Game, MATCH_PALETTE, type GameConfig, type GameEvent } from '../game';

const H = BOARD_HEIGHT;

function newGame(cfg: GameConfig = {}) {
  const g = new Game({ seed: 1, clearDelay: 0, cascadeGravity: 0, tiltEvery: 0, garbageEvery: 0, ...cfg });
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

function clears(events: GameEvent[]) {
  return events.flatMap((e) => (e.type === 'clear' ? [e.clear] : []));
}

describe('color dealing', () => {
  it('deals each queued piece a color from the palette, deterministically by seed', () => {
    const a = new Game({ seed: 7 });
    const b = new Game({ seed: 7 });
    expect(a.queueColors).toHaveLength(a.queue.length);
    expect(a.queueColors).toEqual(b.queueColors);
    for (const c of a.queueColors) expect(MATCH_PALETTE.slice(0, 4)).toContain(c);
  });

  it('spawns and locks pieces in their dealt color', () => {
    const { g } = newGame({ colorMatch: 99 }); // no pops, so the locked cells stay put
    const color = g.queueColors[0];
    g.hardDrop(); // the first piece
    g.hardDrop(); // the second, dealt `color`
    const locked = g.board.grid.flat().filter(Boolean);
    expect(locked).toContain(color);
  });

  it('hold keeps the held piece color', () => {
    const { g } = newGame();
    const color = g.active!.color;
    g.holdPiece();
    expect(g.holdColor).toBe(color);
    g.hardDrop();
    g.holdPiece(); // swap back
    expect(g.active!.color).toBe(color);
  });

  it('uses piece colors when color match is off', () => {
    const g = new Game({ seed: 3, colorMatch: 0 });
    expect(g.queueColors).toEqual(g.queue);
  });
});

describe('color groups', () => {
  it('finds touching same-color groups of at least the minimum size', () => {
    const b = new Board();
    for (let x = 0; x < 4; x++) {
      b.grid[H - 1][x] = 'Z';
      b.grid[H - 2][x] = 'Z';
    }
    b.grid[H - 1][4] = 'J'; // different color touching the group
    b.grid[H - 1][6] = 'Z'; // same color but not touching
    const groups = b.colorGroups(8);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(8);
    expect(b.colorGroups(9)).toHaveLength(0);
  });
});

describe('color match', () => {
  it('pops a group of 8 touching same-color cells and scores it', () => {
    const { g, events } = newGame();
    // a red 4x1 bar on the floor; a red I dropped flat onto it makes a 2x4 red block
    for (let x = 0; x < 4; x++) g.board.grid[H - 1][x] = 'Z';
    g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1, color: 'Z' };
    const before = g.score;
    g.hardDrop();
    const [clear] = clears(events);
    expect(clear.count).toBe(0);
    expect(clear.pops).toHaveLength(1);
    expect(clear.pops[0].color).toBe('Z');
    expect(clear.pops[0].cells).toHaveLength(8);
    expect(clear.label).toContain('8 MATCH');
    g.tick(1);
    expect(g.board.isEmpty()).toBe(true);
    expect(g.popped).toBe(8);
    expect(g.lines).toBe(0);
    // 8 cells * 10, a perfect clear bonus of 800, plus 2 points per hard-dropped row
    expect(g.score - before).toBe(80 + 800 + (H - 2 - HIDDEN_ROWS) * 2);
  });

  it('does not pop smaller groups or other colors', () => {
    const { g, events } = newGame();
    for (let x = 0; x < 4; x++) g.board.grid[H - 1][x] = 'Z';
    g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1, color: 'J' };
    g.hardDrop();
    expect(clears(events)).toHaveLength(0);
    expect(g.board.grid[H - 2][0]).toBe('J');
  });

  it('a pop drops the blocks above it, which can pop again as a chain', () => {
    const { g, events } = newGame();
    // Columns 0-3, three separate pieces stacked on the floor:
    //   H-3  B B B B   piece 2 (blue)
    //   H-2  R R R R   piece 1 (red)
    //   H-1  B B B B   piece 3 (blue)
    // The red layer keeps the two blue bars apart (4 + 4, not touching).
    const layers: [number, 'J' | 'Z', number][] = [
      [H - 1, 'J', 3],
      [H - 2, 'Z', 1],
      [H - 3, 'J', 2],
    ];
    for (const [y, color, id] of layers) {
      for (let x = 0; x < 4; x++) {
        g.board.grid[y][x] = color;
        g.board.ids[y][x] = id;
      }
    }
    // A red vertical I dropped into column 4 touches the red layer: 8 reds pop. The upper
    // blue bar then falls onto the lower one, making 8 touching blues: chain 2.
    g.active = { type: 'I', rot: 1, x: 2, y: HIDDEN_ROWS, color: 'Z' };
    g.hardDrop();
    g.tick(1);
    const cs = clears(events);
    expect(cs.map((c) => c.chain)).toEqual([1, 2]);
    expect(cs[0].pops.map((p) => [p.color, p.cells.length])).toEqual([['Z', 8]]);
    expect(cs[1].pops.map((p) => [p.color, p.cells.length])).toEqual([['J', 8]]);
    expect(cs[1].label).toBe('2 CHAIN 8 MATCH PERFECT CLEAR');
    expect(cs[1].points).toBe(80 * 2 + 800); // doubled for the chain step, plus perfect clear
    expect(g.board.isEmpty()).toBe(true);
    expect(g.maxChain).toBe(2);
  });
});

describe('aiming preview', () => {
  it('reports how many cells a hard drop would pop, without touching the board', () => {
    const { g } = newGame();
    for (let x = 0; x < 4; x++) g.board.grid[H - 1][x] = 'Z';
    g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1, color: 'Z' };
    expect(g.previewPops()).toBe(8);
    g.active.color = 'J';
    expect(g.previewPops()).toBe(0);
    expect(g.board.grid[H - 2].every((c) => c === null)).toBe(true);
  });
});
