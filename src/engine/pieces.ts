export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECE_TYPES: readonly PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export type Rotation = 0 | 1 | 2 | 3;
export type Matrix = readonly (readonly number[])[];

/** Rotation-state-0 shapes. Others are derived by rotating the bounding box (this matches SRS exactly). */
const BASE: Record<PieceType, Matrix> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

function rotateCW(m: Matrix): Matrix {
  const n = m.length;
  const out: number[][] = [];
  for (let y = 0; y < n; y++) {
    out.push([]);
    for (let x = 0; x < n; x++) out[y].push(m[n - 1 - x][y]);
  }
  return out;
}

/** SHAPES[type][rotation] */
export const SHAPES: Record<PieceType, readonly Matrix[]> = Object.fromEntries(
  PIECE_TYPES.map((t) => {
    const r0 = BASE[t];
    const r1 = rotateCW(r0);
    const r2 = rotateCW(r1);
    const r3 = rotateCW(r2);
    return [t, [r0, r1, r2, r3]];
  }),
) as unknown as Record<PieceType, readonly Matrix[]>;

export const COLORS: Record<PieceType, string> = {
  I: '#00f0ff',
  O: '#ffe14d',
  T: '#c85cff',
  S: '#47ff7a',
  Z: '#ff4d6d',
  J: '#4d7cff',
  L: '#ff9a3d',
};

/** Cell offsets for a given type/rotation, relative to the piece origin (top-left of bounding box). */
export function cellsOf(type: PieceType, rot: Rotation): readonly (readonly [number, number])[] {
  return CELLS[type][rot];
}

const CELLS: Record<PieceType, readonly (readonly (readonly [number, number])[])[]> = Object.fromEntries(
  PIECE_TYPES.map((t) => [
    t,
    SHAPES[t].map((m) => {
      const out: [number, number][] = [];
      m.forEach((row, y) => row.forEach((v, x) => v && out.push([x, y])));
      return out;
    }),
  ]),
) as unknown as Record<PieceType, readonly (readonly (readonly [number, number])[])[]>;

type Kick = readonly [number, number];

// SRS kick tables. Values are (dx, dy) with +y DOWN (already converted from the guideline's +y-up convention).
const KICKS_JLSTZ: Record<string, readonly Kick[]> = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};

const KICKS_I: Record<string, readonly Kick[]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const KICKS_180: readonly Kick[] = [[0, 0], [0, -1], [1, 0], [-1, 0], [0, 1]];

export function kicksFor(type: PieceType, from: Rotation, to: Rotation): readonly Kick[] {
  if (type === 'O') return [[0, 0]];
  if ((from + 2) % 4 === to) return KICKS_180;
  const key = `${from}>${to}`;
  return type === 'I' ? KICKS_I[key] : KICKS_JLSTZ[key];
}
