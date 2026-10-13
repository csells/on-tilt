import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS } from '../board';
import { Game, gravitySeconds, type GameEvent } from '../game';
import type { PieceType } from '../pieces';

const H = BOARD_HEIGHT;

function newGame(cfg = {}) {
  const g = new Game({ seed: 1, clearDelay: 0, cascadeGravity: 0, tiltEvery: 0, colorMatch: 0, garbageEvery: 0, ...cfg });
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

/** Fill a row leaving the given columns empty. */
function fillRow(g: Game, y: number, holes: number[] = [], type: PieceType = 'J') {
  for (let x = 0; x < BOARD_WIDTH; x++) g.board.grid[y][x] = holes.includes(x) ? null : type;
}

/** Force the active piece to a type at (default) spawn position. */
function setActive(g: Game, type: PieceType, x?: number, y?: number) {
  const size = type === 'I' ? 4 : type === 'O' ? 2 : 3;
  g.active = {
    type,
    rot: 0,
    x: x ?? Math.floor((BOARD_WIDTH - size) / 2),
    y: y ?? HIDDEN_ROWS - (type === 'I' ? 1 : 0),
  };
}

function lastClear(events: GameEvent[]) {
  const e = events.filter((e) => e.type === 'clear').pop();
  if (!e || e.type !== 'clear') throw new Error('no clear event');
  return e.clear;
}

/** Fill the bottom 4 rows with a well in column 0 and drop a vertical I into it. */
function dropTetris(g: Game) {
  for (let y = H - 4; y < H; y++) fillRow(g, y, [0]);
  setActive(g, 'I');
  g.rotateCW();
  g.active!.x = -2; // vertical I (state 1) occupies column x+2 => column 0
  g.hardDrop();
  g.tick(1);
}

describe('Game basics', () => {
  it('spawns a piece on start with a full preview queue', () => {
    const { g } = newGame();
    expect(g.phase).toBe('falling');
    expect(g.active).not.toBeNull();
    expect(g.queue).toHaveLength(5);
  });

  it('moves left/right within bounds', () => {
    const { g } = newGame();
    setActive(g, 'O');
    const x0 = g.active!.x;
    expect(g.moveLeft()).toBe(true);
    expect(g.active!.x).toBe(x0 - 1);
    for (let i = 0; i < 20; i++) g.moveLeft();
    expect(g.active!.x).toBe(0);
    for (let i = 0; i < 20; i++) g.moveRight();
    expect(g.active!.x).toBe(BOARD_WIDTH - 2);
  });

  it('hard drop locks the piece at the bottom and awards 2 points/cell', () => {
    const { g, events } = newGame();
    setActive(g, 'O');
    const dist = g.ghostY() - g.active!.y;
    g.hardDrop();
    expect(g.score).toBe(dist * 2);
    expect(g.board.grid[H - 1].filter(Boolean)).toHaveLength(2);
    expect(events.some((e) => e.type === 'lock')).toBe(true);
    expect(g.phase).toBe('falling'); // next piece spawned
  });

  it('gravity moves the piece down over time', () => {
    const { g } = newGame();
    setActive(g, 'T');
    const y0 = g.active!.y;
    g.tick(g.gravityMs + 1);
    expect(g.active!.y).toBe(y0 + 1);
  });

  it('runs piece gravity a few levels ahead of the displayed level', () => {
    expect(newGame().g.gravityMs).toBeCloseTo(gravitySeconds(4) * 1000);
    expect(newGame({ gravityBoost: 0 }).g.gravityMs).toBeCloseTo(gravitySeconds(1) * 1000);
  });

  it('locks after lock delay when grounded', () => {
    const { g } = newGame({ lockDelay: 500 });
    setActive(g, 'O');
    g.active!.y = g.ghostY();
    g.tick(499);
    expect(g.piecesPlaced).toBe(0);
    expect(g.lockProgress()).toBeGreaterThan(0.9);
    g.tick(2);
    expect(g.piecesPlaced).toBe(1);
    expect(g.board.grid[H - 1].some(Boolean)).toBe(true);
  });

  it('move reset extends lock delay, but only up to the cap', () => {
    const { g } = newGame({ lockDelay: 100, maxLockResets: 2 });
    setActive(g, 'O', 4);
    g.active!.y = g.ghostY();
    g.tick(90);
    g.moveLeft(); // reset 1
    g.tick(90);
    expect(g.piecesPlaced).toBe(0);
    g.moveRight(); // reset 2
    g.tick(90);
    expect(g.piecesPlaced).toBe(0);
    g.moveLeft(); // out of resets: timer keeps running
    g.tick(20);
    expect(g.piecesPlaced).toBe(1);
  });

  it('hold swaps pieces and is limited to once per piece', () => {
    const { g } = newGame();
    const first = g.active!.type;
    const next = g.queue[0];
    expect(g.holdPiece()).toBe(true);
    expect(g.hold).toBe(first);
    expect(g.active!.type).toBe(next);
    expect(g.holdPiece()).toBe(false);
    g.hardDrop();
    expect(g.canHold).toBe(true);
    expect(g.holdPiece()).toBe(true);
    expect(g.active!.type).toBe(first);
  });

  it('SRS wall kick lets an I rotate against the wall', () => {
    const { g } = newGame();
    setActive(g, 'I', 0, 30);
    g.rotateCW(); // vertical at column 2
    for (let i = 0; i < 5; i++) g.moveLeft(); // flush against left wall (column 0)
    expect(g.active!.x).toBe(-2);
    expect(g.rotateCW()).toBe(true); // needs a kick to become horizontal
    expect(g.active!.x).toBeGreaterThanOrEqual(0);
  });
});

describe('line clears and scoring', () => {
  it('clears a single line and scores 100 * level', () => {
    const { g, events } = newGame();
    fillRow(g, H - 1, [4, 5]);
    setActive(g, 'O', 4);
    g.hardDrop();
    expect(lastClear(events).count).toBe(1);
    g.tick(1); // finish the (0ms) clear animation
    expect(g.lines).toBe(1);
    expect(g.board.grid[H - 1].filter(Boolean)).toHaveLength(2); // top half of the O collapsed down
    const dropPts = (H - 2 - HIDDEN_ROWS) * 2;
    expect(g.score).toBe(100 + dropPts);
  });

  it('scores a tetris and back-to-back tetris', () => {
    const { g, events } = newGame();
    g.board.grid[H - 5][9] = 'J'; // stray cell so this is not a perfect clear
    dropTetris(g);
    let clear = lastClear(events);
    expect(clear.count).toBe(4);
    expect(clear.b2b).toBe(false);
    expect(clear.label).toBe('TETRIS');
    expect(clear.points).toBe(800);
    expect(g.lines).toBe(4);

    g.board.grid[H - 5][9] = 'J';
    dropTetris(g);
    clear = lastClear(events);
    expect(clear.b2b).toBe(true);
    expect(clear.points).toBe(1250); // 800 * 1.5 b2b + 50 combo
  });

  it('levels up every 10 lines', () => {
    const { g, events } = newGame();
    for (let i = 0; i < 3; i++) dropTetris(g);
    expect(g.lines).toBe(12);
    expect(g.level).toBe(2);
    expect(events.some((e) => e.type === 'levelup')).toBe(true);
  });

  it('detects a perfect clear', () => {
    const { g, events } = newGame();
    fillRow(g, H - 1, [4, 5]);
    fillRow(g, H - 2, [4, 5]);
    setActive(g, 'O', 4);
    g.hardDrop();
    const clear = lastClear(events);
    expect(clear.perfect).toBe(true);
    expect(clear.label).toBe('DOUBLE PERFECT CLEAR');
    g.tick(1);
    expect(g.board.isEmpty()).toBe(true);
  });

  it('tracks combos across consecutive clears', () => {
    const { g, events } = newGame();
    for (let y = H - 4; y < H; y++) fillRow(g, y, [4, 5]);
    setActive(g, 'O', 4);
    g.hardDrop();
    g.tick(1);
    setActive(g, 'O', 4);
    g.hardDrop();
    const clears = events.filter((e) => e.type === 'clear');
    expect(clears).toHaveLength(2);
    expect(lastClear(events).combo).toBe(1);
  });
});

describe('T-spins', () => {
  /**
   * Classic T-spin double slot (bottom of board):
   *   H-3:  . . X . . . . . . .   <- overhang at column 2
   *   H-2:  X X . . . X X X X X   <- T bar goes here
   *   H-1:  X X X . X X X X X X   <- T stem goes here
   * The T enters vertically (state 1) with its stem in column 3, then rotates CW into state 2.
   */
  function buildSlot(g: Game) {
    fillRow(g, H - 1, [3]);
    fillRow(g, H - 2, [2, 3, 4]);
    g.board.grid[H - 3][2] = 'J';
  }

  it('scores a T-spin double when rotating into the slot', () => {
    const { g, events } = newGame();
    buildSlot(g);
    setActive(g, 'T', 2, H - 6);
    expect(g.rotateCW()).toBe(true); // state 1, stem column 3
    g.active!.y = g.ghostY();
    expect(g.active!.y).toBe(H - 3);
    expect(g.rotateCW()).toBe(true); // state 2: bar in row H-2, stem in row H-1
    expect(g.active!.rot).toBe(2);
    g.hardDrop();
    const clear = lastClear(events);
    expect(clear.tspin).toBe('full');
    expect(clear.count).toBe(2);
    expect(clear.label).toBe('T-SPIN DOUBLE');
    expect(clear.points).toBe(1200);
    expect(clear.b2b).toBe(false);
  });

  it('T-spin then tetris keeps back-to-back', () => {
    const { g, events } = newGame();
    buildSlot(g);
    setActive(g, 'T', 2, H - 6);
    g.rotateCW();
    g.active!.y = g.ghostY();
    g.rotateCW();
    g.hardDrop();
    g.tick(1);
    g.board.clear();
    g.board.grid[H - 5][9] = 'J';
    dropTetris(g);
    const clear = lastClear(events);
    expect(clear.b2b).toBe(true);
    expect(clear.points).toBe(1250); // 800 * 1.5 b2b + 50 combo
  });

  /**
   * Mini T-spin: 3 corners filled but only one "front" corner.
   *   H-3:  . . X . . . . . . .
   *   H-2:  X X . . . X X X X X
   *   H-1:  X X X . X X X X X X  (hole at col 3 lets the stem rotate down and back)
   * The T sits pointing up at origin (2, H-3); rotating CW then CCW returns it in place.
   */
  function buildMiniSlot(g: Game) {
    fillRow(g, H - 1, [0, 3]);
    fillRow(g, H - 2, [2, 3, 4]);
  }

  it('scores a mini T-spin when only one front corner is filled', () => {
    const { g, events } = newGame();
    buildMiniSlot(g);
    g.board.grid[H - 3][2] = 'J';
    setActive(g, 'T', 2, H - 3);
    expect(g.rotateCW()).toBe(true);
    expect(g.rotateCCW()).toBe(true);
    expect(g.active).toMatchObject({ x: 2, y: H - 3, rot: 0 });
    g.hardDrop();
    const clear = lastClear(events);
    expect(clear.tspin).toBe('mini');
    expect(clear.count).toBe(1);
    expect(clear.label).toBe('MINI T-SPIN SINGLE');
    expect(clear.points).toBe(200);
  });

  it('does not count a T-spin if the last move was a translation', () => {
    const { g, events } = newGame();
    buildMiniSlot(g);
    setActive(g, 'T', 2, H - 5);
    g.rotateCW();
    g.rotateCCW();
    expect(g.softDrop()).toBe(true);
    expect(g.softDrop()).toBe(true);
    expect(g.active!.y).toBe(H - 3);
    g.board.grid[H - 3][2] = 'J'; // now 3 corners are filled, same as the mini case above
    g.hardDrop();
    const clear = lastClear(events);
    expect(clear.tspin).toBe('none');
    expect(clear.count).toBe(1);
    expect(clear.label).toBe('SINGLE');
  });
});

describe('game over', () => {
  it('ends the game when a spawn is blocked', () => {
    const { g, events } = newGame();
    for (let y = HIDDEN_ROWS - 2; y < H; y++) fillRow(g, y, [0]);
    setActive(g, 'O', 4);
    g.hardDrop();
    expect(g.phase).toBe('over');
    expect(events.at(-1)?.type).toBe('gameover');
  });
});
