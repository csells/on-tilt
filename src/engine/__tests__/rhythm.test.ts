import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS } from '../board';
import { Game, GROOVE_STEP, MAX_GROOVE, type GameEvent } from '../game';

const H = BOARD_HEIGHT;

function newGame(offset: number | null) {
  const g = new Game({ seed: 1, clearDelay: 0, cascadeGravity: 0, tiltEvery: 0, colorMatch: 0, garbageEvery: 0, beatWindow: 75 });
  g.beatClock = () => offset;
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  g.start();
  return { g, events };
}

describe('groove', () => {
  it('builds on consecutive on-beat locks and caps the multiplier', () => {
    const { g, events } = newGame(-40);
    for (let i = 0; i < 3; i++) {
      g.board.clear();
      g.hardDrop();
    }
    expect(g.groove).toBe(3);
    expect(g.grooveMultiplier).toBe(1 + 3 * GROOVE_STEP);
    expect(events.filter((e) => e.type === 'beat').every((e) => e.type === 'beat' && e.onBeat)).toBe(true);
    g.groove = 50;
    expect(g.grooveMultiplier).toBe(1 + MAX_GROOVE * GROOVE_STEP);
  });

  it('an off-beat lock drops the groove', () => {
    let offset = 10;
    const { g } = newGame(0);
    g.beatClock = () => offset;
    g.hardDrop();
    g.hardDrop();
    expect(g.groove).toBe(2);
    offset = 200;
    g.hardDrop();
    expect(g.groove).toBe(0);
    expect(g.bestGroove).toBe(2);
  });

  it('multiplies clear points', () => {
    const { g, events } = newGame(0);
    g.groove = 3; // the clearing lock makes it 4: x2
    for (let x = 0; x < BOARD_WIDTH; x++) g.board.grid[H - 1][x] = x === 4 || x === 5 ? null : 'J';
    g.active = { type: 'O', rot: 0, x: 4, y: HIDDEN_ROWS };
    g.hardDrop();
    const clear = events.flatMap((e) => (e.type === 'clear' ? [e.clear] : []))[0];
    expect(g.groove).toBe(4);
    expect(clear.points).toBe(200); // a 100-point single, doubled
  });

  it('does nothing without a beat to play to', () => {
    const { g, events } = newGame(null);
    g.hardDrop();
    expect(g.groove).toBe(0);
    expect(events.some((e) => e.type === 'beat')).toBe(false);
  });
});
