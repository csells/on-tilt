import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, GARBAGE } from '../board';
import { DANGER_HEAT, Game, MAX_HEAT, type GameConfig, type GameEvent } from '../game';

const H = BOARD_HEIGHT;

function newGame(cfg: GameConfig = {}) {
  const g = new Game({
    seed: 1,
    clearDelay: 0,
    cascadeGravity: 0,
    nudgeTurn: 0,
    tiltEvery: 0,
    colorMatch: 0,
    garbageEvery: 0,
    nudgeHeat: 35,
    heatCool: 10,
    tiltOutMs: 3000,
    ...cfg,
  });
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

describe('nudge', () => {
  it('slides the stack sideways and hands back the same falling piece', () => {
    const { g, events } = newGame();
    g.board.grid[H - 1][4] = 'J';
    const piece = { ...g.active! };
    expect(g.nudge('right')).toBe(true);
    expect(g.phase).toBe('tilting');
    expect(g.active).toBeNull();
    g.tick(1);
    expect(g.phase).toBe('falling');
    expect(g.active).toMatchObject({ type: piece.type, x: piece.x, rot: piece.rot });
    expect(g.board.grid[H - 1][BOARD_WIDTH - 1]).toBe('J');
    expect(events.find((e) => e.type === 'tilt')).toEqual({ type: 'tilt', dir: 'right', nudge: true });
    expect(g.piecesPlaced).toBe(0); // no piece was spent
  });

  it('heats the tilt meter, which cools over time', () => {
    const { g } = newGame();
    g.nudge('left');
    g.tick(1);
    expect(g.heat).toBeCloseTo(35, 0);
    g.tick(2000);
    expect(g.heat).toBeCloseTo(15, 0);
    g.tick(10000);
    expect(g.heat).toBe(0);
  });

  it('tilts out when nudged too hard: dead controls and a garbage row', () => {
    const { g, events } = newGame();
    g.nudge('left');
    g.tick(1);
    g.nudge('right');
    g.tick(1);
    expect(g.heat).toBeGreaterThan(DANGER_HEAT);
    expect(g.nudge('left')).toBe(false); // 70 + 35 >= MAX_HEAT
    expect(events.some((e) => e.type === 'tilted')).toBe(true);
    expect(g.tiltedFor).toBe(3000);
    expect(g.heat).toBe(0);
    // dead controls
    const x = g.active!.x;
    expect(g.moveLeft()).toBe(false);
    expect(g.rotateCW()).toBe(false);
    expect(g.holdPiece()).toBe(false);
    g.hardDrop();
    expect(g.active!.x).toBe(x);
    expect(g.piecesPlaced).toBe(0);
    // the piece still falls and locks on its own; the penalty garbage comes in after it
    g.tick(3001);
    while (g.piecesPlaced === 0) g.tick(100);
    expect(g.board.grid[H - 1].filter((c) => c === GARBAGE)).toHaveLength(BOARD_WIDTH - 1);
    expect(g.tiltedFor).toBe(0);
    expect(g.moveLeft() || g.moveRight()).toBe(true);
    expect(MAX_HEAT).toBe(100);
  });

  it('only works while a piece is falling', () => {
    const { g } = newGame({ nudgeTurn: 200 });
    g.nudge('left');
    expect(g.phase).toBe('tilting');
    expect(g.nudge('right')).toBe(false);
  });

  it('lifts the piece clear if the slide moved blocks under it', () => {
    const { g } = newGame();
    // a T against the right wall: its bottom row covers columns 7-9 at row y+1
    const y0 = 25;
    g.active = { type: 'T', rot: 0, x: BOARD_WIDTH - 3, y: y0 };
    // a tall column at the far left reaching up to row y0-2; sliding right parks it in column 9
    for (let y = y0 - 2; y < H; y++) g.board.grid[y][0] = 'J';
    const cells = () => g.board.grid.flat().filter(Boolean).length;
    const before = cells();
    g.nudge('right');
    g.tick(1);
    expect(g.board.grid[y0 - 2][BOARD_WIDTH - 1]).toBe('J');
    expect(g.phase).toBe('falling');
    expect(g.active!.y).toBe(y0 - 4); // lifted until its bottom row clears the column top
    expect(g.board.fits('T', 0, g.active!.x, g.active!.y)).toBe(true);
    expect(cells()).toBe(before);
  });
});
