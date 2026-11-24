<script lang="ts">
  import type { Action } from 'svelte/action';
  import type { AssetItem, BucketRef } from '@gallery/shared';
  import { estimateBucketHeight } from '$lib/layout/justified';
  import type { FavouritesStore } from '$lib/stores/favourites';
  import BucketSection from './BucketSection.svelte';

  let {
    buckets,
    albumSlug,
    cam = null,
    theme = 'dark',
    favourites = null,
    onopen,
    onloaded
  }: {
    buckets: BucketRef[];
    albumSlug: string;
    cam?: string | null;
    theme?: 'light' | 'dark';
    favourites?: FavouritesStore | null;
    onopen: (id: string) => void;
    onloaded: (cacheKey: string, items: AssetItem[]) => void;
  } = $props();

  let width = $state(0);
  let heights = $state<Record<string, number>>({});
  let active = $state<Record<string, boolean>>({});

  const cache = new Map<string, { items: AssetItem[]; nextCursor: string | null }>();

  const compact = $derived(width > 0 && width < 640);
  const gap = $derived(compact ? 2 : 4);
  const targetRowHeight = $derived(compact ? 130 : 200);

  function cacheKeyFor(bucket: BucketRef): string {
    return `${cam ?? 'all'}:${bucket.key}`;
  }

  function heightFor(bucket: BucketRef): number {
    return (
      heights[bucket.key] ??
      estimateBucketHeight(Math.min(bucket.count || 40, 96), {
        width: width || 1000,
        targetRowHeight,
        gap
      })
    );
  }

  function store(key: string, items: AssetItem[], nextCursor: string | null) {
    cache.set(key, { items, nextCursor });
    onloaded(key, items);
  }

  const observe: Action<
    HTMLElement,
    { key: string; onvisible: (key: string, visible: boolean) => void }
  > = (node, params) => {
    const observer = new IntersectionObserver(
      (entries) => {
        params.onvisible(params.key, entries.some((entry) => entry.isIntersecting));
      },
      { root: null, rootMargin: '900px 0px 900px 0px' }
    );
    observer.observe(node);
    return {
      update(next) {
        params = next;
      },
      destroy() {
        observer.disconnect();
      }
    };
  };

  const measure: Action<HTMLElement, { bucketKey: string; onheight: (key: string, height: number) => void }> = (
    node,
    params
  ) => {
    const observer = new ResizeObserver(() => params.onheight(params.bucketKey, node.offsetHeight));
    observer.observe(node);
    return {
      update(next) {
        params = next;
      },
      destroy() {
        observer.disconnect();
      }
    };
  };
</script>

<div class="list" bind:clientWidth={width}>
  {#each buckets as bucket (bucket.key)}
    {@const key = cacheKeyFor(bucket)}
    <div
      class="slot"
      style:min-height={`${heightFor(bucket)}px`}
      use:observe={{
        key: bucket.key,
        onvisible: (bucketKey, visible) => {
          if (visible) {
            active = { ...active, [bucketKey]: true };
          } else if (active[bucketKey]) {
            active = { ...active, [bucketKey]: false };
          }
        }
      }}
    >
      {#if active[bucket.key]}
        <div
          use:measure={{
            bucketKey: bucket.key,
            onheight: (bucketKey, height) => {
              if (height > 0 && Math.abs((heights[bucketKey] ?? 0) - height) > 1) {
                heights = { ...heights, [bucketKey]: height };
              }
            }
          }}
        >
          <BucketSection
            {bucket}
            {albumSlug}
            {cam}
            {theme}
            {favourites}
            {targetRowHeight}
            {gap}
            cacheKey={key}
            initial={cache.get(key)}
            {onopen}
            onitems={store}
          />
        </div>
      {:else}
        <div class="placeholder" style:height={`${heightFor(bucket)}px`} aria-hidden="true"></div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .slot {
    min-width: 0;
  }

  .placeholder {
    width: 100%;
  }
</style>
