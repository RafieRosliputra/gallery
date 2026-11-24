import { describe, expect, it } from 'vitest';
import { estimateBucketHeight, justifiedRows } from './justified';

const items = (n: number, ratio: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}`, w: ratio * 1000, h: 1000 }));

describe('justifiedRows', () => {
  it('fills every complete row exactly, allowing for rounding', () => {
    const rows = justifiedRows(items(10, 1.5), { width: 1000, targetRowHeight: 200, gap: 4 });
    const full = rows.slice(0, -1);
    expect(full.length).toBeGreaterThan(0);
    for (const row of full) {
      const used = row.tiles.reduce((sum, tile) => sum + tile.width, 0) + 4 * (row.tiles.length - 1);
      expect(used).toBeCloseTo(1000, 1);
    }
  });

  it('never crops: width / height equals the source aspect', () => {
    const mixed = [
      { id: 'p', w: 800, h: 1200 },
      { id: 'l', w: 1200, h: 800 },
      { id: 's', w: 1000, h: 1000 },
      { id: 'p2', w: 900, h: 1350 }
    ];
    const rows = justifiedRows(mixed, { width: 820, targetRowHeight: 130, gap: 2 });
    for (const row of rows) {
      for (const tile of row.tiles) {
        expect(tile.width / tile.height).toBeCloseTo(tile.aspect, 2);
      }
    }
  });

  it('keeps the last row at target height instead of stretching it', () => {
    const rows = justifiedRows(items(3, 1.5), { width: 1000, targetRowHeight: 200, gap: 4 });
    const last = rows[rows.length - 1];
    expect(last.height).toBeLessThanOrEqual(200);
    const used = last.tiles.reduce((sum, tile) => sum + tile.width, 0) + 4 * (last.tiles.length - 1);
    expect(used).toBeLessThan(1000);
  });

  it('caps a tall row and leaves it left aligned', () => {
    const rows = justifiedRows(items(12, 0.6), { width: 300, targetRowHeight: 130, gap: 2 });
    for (const row of rows) {
      expect(row.height).toBeLessThanOrEqual(130 * 1.8);
    }
  });

  it('returns no rows for an empty or unmeasured container', () => {
    expect(justifiedRows(items(5, 1), { width: 0, targetRowHeight: 200 })).toEqual([]);
    expect(justifiedRows([], { width: 1000, targetRowHeight: 200 })).toEqual([]);
  });

  it('falls back to a square for invalid dimensions', () => {
    const rows = justifiedRows([{ id: 'bad', w: 0, h: 0 }], { width: 1000, targetRowHeight: 200 });
    expect(rows[0].tiles[0].aspect).toBe(1);
  });
});

describe('estimateBucketHeight', () => {
  it('grows with the bucket count', () => {
    const small = estimateBucketHeight(20, { width: 1000, targetRowHeight: 200 });
    const big = estimateBucketHeight(200, { width: 1000, targetRowHeight: 200 });
    expect(big).toBeGreaterThan(small);
  });
});
