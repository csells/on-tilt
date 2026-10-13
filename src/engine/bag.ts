import { PIECE_TYPES, type PieceType } from './pieces';

/** Deterministic PRNG (mulberry32) so games can be seeded/replayed and tests are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Guideline 7-bag randomizer: every 7 pieces contains each tetromino exactly once. */
export class SevenBag {
  private bag: PieceType[] = [];
  private readonly rng: () => number;

  constructor(seed: number = Date.now()) {
    this.rng = mulberry32(seed);
  }

  next(): PieceType {
    if (this.bag.length === 0) this.refill();
    return this.bag.pop()!;
  }

  private refill(): void {
    const b = [...PIECE_TYPES];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    this.bag = b;
  }
}
