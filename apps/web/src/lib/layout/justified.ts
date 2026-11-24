export interface AspectItem {
  id: string;
  w: number;
  h: number;
}

export interface LayoutOptions {
  /** Usable container width in CSS pixels. */
  width: number;
  /** Preferred row height before a row is flushed. */
  targetRowHeight: number;
  /** Horizontal and vertical gutter. */
  gap?: number;
  /** A row never grows past this; full rows get left-aligned when capped. */
  maxRowHeight?: number;
}

export interface LayoutTile {
  id: string;
  width: number;
  height: number;
  aspect: number;
}

export interface LayoutRow {
  height: number;
  tiles: LayoutTile[];
}

function aspectOf(item: AspectItem): number {
  if (!Number.isFinite(item.w) || !Number.isFinite(item.h) || item.w <= 0 || item.h <= 0) return 1;
  return item.w / item.h;
}

/**
 * Flickr-style justified rows, computed from real aspect ratios.
 *
 * A row is flushed once its natural width at `targetRowHeight` reaches the
 * container. The row is then scaled so tile widths + gaps fill the container
 * exactly (no crop, no letterbox), capped by `maxRowHeight`. The final row is
 * never stretched past `targetRowHeight`, so two photos at the end do not
 * become billboards.
 */
export function justifiedRows(items: readonly AspectItem[], options: LayoutOptions): LayoutRow[] {
  const { width, targetRowHeight } = options;
  const gap = options.gap ?? 4;
  const maxRowHeight = options.maxRowHeight ?? targetRowHeight * 1.8;

  if (!Number.isFinite(width) || width <= 0 || targetRowHeight <= 0) return [];

  const rows: LayoutRow[] = [];
  let pending: { item: AspectItem; aspect: number }[] = [];
  let aspectSum = 0;

  const flush = (last: boolean) => {
    if (pending.length === 0) return;
    const gaps = gap * (pending.length - 1);
    const natural = (width - gaps) / aspectSum;
    const height = Math.max(1, Math.min(last ? targetRowHeight : natural, maxRowHeight));
    rows.push({
      height,
      tiles: pending.map(({ item, aspect }) => ({
        id: item.id,
        aspect,
        width: Math.round(aspect * height * 100) / 100,
        height: Math.round(height * 100) / 100
      }))
    });
    pending = [];
    aspectSum = 0;
  };

  for (const item of items) {
    const aspect = aspectOf(item);
    pending.push({ item, aspect });
    aspectSum += aspect;
    const naturalWidth = aspectSum * targetRowHeight + gap * (pending.length - 1);
    if (naturalWidth >= width) flush(false);
  }
  flush(true);
  return rows;
}

/** Height a bucket is expected to occupy before it has been measured. */
export function estimateBucketHeight(itemCount: number, options: LayoutOptions): number {
  const gap = options.gap ?? 4;
  const perRow = Math.max(1, Math.min(5, options.width / (options.targetRowHeight * 0.85)));
  const rows = Math.max(1, Math.ceil(itemCount / perRow));
  return rows * (options.targetRowHeight + gap) + 56;
}
