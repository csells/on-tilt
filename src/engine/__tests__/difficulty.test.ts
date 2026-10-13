import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, GARBAGE, HIDDEN_ROWS } from '../board';
import { BIGGER_MATCH_LEVEL, EXTRA_COLOR_LEVEL, Game, type GameConfig, type GameEvent } from '../game';

const H = BOARD_HEIGHT;

function newGame(cfg: GameConfig = {}) {
  const g = new Game({ seed: 1, clearDelay: 0, cascadeGravity: 0, tiltEvery: 0, ...cfg });
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

/** Hard-drop the current piece flat against the left wall (keeps the drop zone predictable). */
function dropLeft(g: Game) {
  while (g.moveLeft()) {
    /* to the wall */
  }
  g.hardDrop();
  g.tick(1);
}

const garbageRows = (g: Game) => g.board.grid.filter((row) => row.includes(GARBAGE)).length;

describe('rising garbage', () => {
  it('raises a garbage row with a single hole every N pieces', () => {
    const { g, events } = newGame({ colorMatch: 0, garbageEvery: 4 });
    for (let i = 0; i < 3; i++) dropLeft(g);
    expect(garbageRows(g)).toBe(0);
    expect(g.garbageIn).toBe(1);
    dropLeft(g);
    expect(events.filter((e) => e.type === 'garbage')).toHaveLength(1);
    const bottom = g.board.grid[H - 1];
    expect(bottom.filter((c) => c === GARBAGE)).toHaveLength(BOARD_WIDTH - 1);
    expect(bottom.filter((c) => c === null)).toHaveLength(1);
    expect(g.garbageIn).toBe(4);
  });

  it('pushes the stack up rather than overwriting it', () => {
    const { g } = newGame({ colorMatch: 0, garbageEvery: 1 });
    g.board.grid[H - 1][0] = 'T';
    dropLeft(g); // locks a piece, then a garbage row comes in underneath everything
    expect(g.board.grid[H - 2][0]).toBe('T');
    expect(garbageRows(g)).toBe(1);
  });

  it('comes faster at higher levels, down to every 3 pieces', () => {
    expect(new Game({ garbageEvery: 8 }).garbageInterval()).toBe(8);
    expect(new Game({ garbageEvery: 8, startLevel: 3 }).garbageInterval()).toBe(6);
    expect(new Game({ garbageEvery: 8, startLevel: 20 }).garbageInterval()).toBe(3);
    expect(new Game({ garbageEvery: 0 }).garbageInterval()).toBe(Infinity);
  });

  it('ends the game when garbage would push blocks off the top', () => {
    const { g, events } = newGame({ colorMatch: 0, garbageEvery: 1 });
    g.board.grid[0][5] = 'T'; // something already at the very top of the buffer
    dropLeft(g);
    expect(g.phase).toBe('over');
    expect(events.some((e) => e.type === 'gameover')).toBe(true);
  });

  it('never color-matches, but breaks when a neighboring group pops', () => {
    const { g, events } = newGame({ garbageEvery: 0 });
    // 9 garbage cells in a row would be a "group" if garbage could match.
    for (let x = 0; x < 9; x++) g.board.grid[H - 1][x] = GARBAGE;
    // a red bar resting on the garbage; a red I dropped on it pops 8 reds
    for (let x = 0; x < 4; x++) g.board.grid[H - 2][x] = 'Z';
    g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1, color: 'Z' };
    g.hardDrop();
    const clear = events.flatMap((e) => (e.type === 'clear' ? [e.clear] : []))[0];
    expect(clear.pops).toHaveLength(1);
    expect(clear.garbage.map(([x]) => x).sort()).toEqual([0, 1, 2, 3]); // only the cells under the reds
    g.tick(1);
    expect(g.board.grid[H - 1].filter((c) => c === GARBAGE)).toHaveLength(5);
  });
});

describe('level rules', () => {
  it('adds a fifth color and bigger matches as levels rise', () => {
    const at = (level: number) => new Game({ startLevel: level });
    expect([at(1).colorCount, at(1).matchSize]).toEqual([4, 8]);
    expect([at(EXTRA_COLOR_LEVEL).colorCount, at(EXTRA_COLOR_LEVEL).matchSize]).toEqual([5, 8]);
    expect([at(BIGGER_MATCH_LEVEL).colorCount, at(BIGGER_MATCH_LEVEL).matchSize]).toEqual([5, 10]);
  });

  it('a group of 8 does not pop once matches need 10', () => {
    const { g, events } = newGame({ startLevel: BIGGER_MATCH_LEVEL, garbageEvery: 0 });
    for (let x = 0; x < 4; x++) g.board.grid[H - 1][x] = 'Z';
    g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1, color: 'Z' };
    g.hardDrop();
    expect(events.some((e) => e.type === 'clear')).toBe(false);
  });

  it('counts popped groups toward the next level', () => {
    const { g } = newGame({ garbageEvery: 0 });
    for (let i = 0; i < 10; i++) {
      g.board.clear();
      for (let x = 0; x < 4; x++) g.board.grid[H - 1][x] = 'Z';
      g.active = { type: 'I', rot: 0, x: 0, y: HIDDEN_ROWS - 1, color: 'Z' };
      g.hardDrop();
      g.tick(1);
    }
    expect(g.lines).toBe(0);
    expect(g.progress).toBe(10);
    expect(g.level).toBe(2);
  });
});
