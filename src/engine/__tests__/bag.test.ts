import { describe, expect, it } from 'vitest';
import { SevenBag } from '../bag';
import { PIECE_TYPES } from '../pieces';

describe('SevenBag', () => {
  it('yields each piece exactly once per 7 draws', () => {
    const bag = new SevenBag(42);
    for (let round = 0; round < 20; round++) {
      const drawn = Array.from({ length: 7 }, () => bag.next()).sort();
      expect(drawn).toEqual([...PIECE_TYPES].sort());
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new SevenBag(7);
    const b = new SevenBag(7);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
});
