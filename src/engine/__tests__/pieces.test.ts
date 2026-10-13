import { describe, expect, it } from 'vitest';
import { cellsOf, kicksFor, PIECE_TYPES, SHAPES } from '../pieces';

describe('pieces', () => {
  it('every rotation of every piece has exactly 4 cells', () => {
    for (const t of PIECE_TYPES) {
      for (let r = 0; r < 4; r++) expect(cellsOf(t, r as 0 | 1 | 2 | 3)).toHaveLength(4);
    }
  });

  it('four CW rotations return to the original shape', () => {
    for (const t of PIECE_TYPES) expect(SHAPES[t][0]).toEqual(SHAPES[t][0]);
  });

  it('matches SRS I-piece rotation states', () => {
    // state 1: vertical in column 2
    expect(cellsOf('I', 1)).toEqual([[2, 0], [2, 1], [2, 2], [2, 3]]);
    // state 2: horizontal on row 2
    expect(cellsOf('I', 2)).toEqual([[0, 2], [1, 2], [2, 2], [3, 2]]);
  });

  it('T rotation states match SRS', () => {
    expect(cellsOf('T', 1)).toEqual([[1, 0], [1, 1], [2, 1], [1, 2]]);
    expect(cellsOf('T', 3)).toEqual([[1, 0], [0, 1], [1, 1], [1, 2]]);
  });

  it('O piece has no kicks; others have 5', () => {
    expect(kicksFor('O', 0, 1)).toHaveLength(1);
    expect(kicksFor('T', 0, 1)).toHaveLength(5);
    expect(kicksFor('I', 0, 1)).toHaveLength(5);
    expect(kicksFor('T', 0, 1)[0]).toEqual([0, 0]);
  });
});
