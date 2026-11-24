<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset, BucketRef } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatCount } from '$lib/format';
  import type { FavouritesStore } from '$lib/stores/favourites';
  import JustifiedGrid from './JustifiedGrid.svelte';

  let {
    bucket,
    albumSlug,
    cam = null,
    theme = 'dark',
    favourites = null,
    targetRowHeight,
    gap,
    cacheKey,
    initial,
    onopen,
    onitems
  }: {
    bucket: BucketRef;
    albumSlug: string;
    cam?: string | null;
    theme?: 'light' | 'dark';
    favourites?: FavouritesStore | null;
    targetRowHeight: number;
    gap: number;
    cacheKey: string;
    initial?: { items: Asset[]; nextCursor: string | null };
    onopen: (id: string) => void;
    onitems: (cacheKey: string, items: Asset[], nextCursor: string | null) => void;
  } = $props();

  // Initial data comes from the virtual list cache; it is intentionally read once.
  // svelte-ignore state_referenced_locally
  let items = $state<Asset[]>(initial?.items ?? []);
  // svelte-ignore state_referenced_locally
  let nextCursor = $state<string | null>(initial?.nextCursor ?? null);
  // svelte-ignore state_referenced_locally
  let started = $state(Boolean(initial));
  let loading = $state(false);
  let error = $state('');
  let sentinel: HTMLDivElement | undefined = $state();

  onMount(() => {
    if (!started) void loadMore();
  });

  onMount(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  async function loadMore() {
    if (loading) return;
    if (started && nextCursor === null) return;
    loading = true;
    error = '';
    try {
      const page = await api.getBucket(bucket.key, {
        album: albumSlug,
        cam,
        cursor: nextCursor ?? undefined,
        limit: 60
      });
      const seen = new Set(items.map((item) => item.id));
      const merged = [...items, ...page.items.filter((item) => !seen.has(item.id))];
      items = merged;
      nextCursor = page.nextCursor;
      started = true;
      onitems(cacheKey, merged, page.nextCursor);
    } catch (cause) {
      console.error('bucket gagal', cause);
      error = 'Gambar tak dapat dimuatkan.';
    } finally {
      loading = false;
    }
  }
</script>

<section class="bucket" aria-label={bucket.label ?? bucket.key}>
  {#if bucket.label !== ''}<h2>{bucket.label ?? bucket.key}</h2>{/if}
  <JustifiedGrid
    assets={items}
    {targetRowHeight}
    {gap}
    {theme}
    {favourites}
    {onopen}
    ariaLabel={bucket.label ?? bucket.key}
  />
  {#if error}
    <button type="button" class="retry" onclick={loadMore}>{error} Cuba lagi</button>
  {/if}
  <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
  {#if loading}
    <p class="status" aria-busy="true">Memuatkan {formatCount(bucket.count)} gambar…</p>
  {:else if nextCursor !== null}
    <button type="button" class="more" onclick={loadMore}>Muat lagi</button>
  {/if}
</section>

<style>
  .bucket {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    color: #d7dddf;
  }

  .status {
    color: var(--muted);
    font-size: 13px;
    padding: 10px 0;
  }

  .retry,
  .more {
    align-self: center;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line-hard);
    border-radius: 22px;
    background: transparent;
    color: var(--text);
    font-size: 14px;
  }

  .retry {
    border-color: #8a2a24;
    color: #f2b8b3;
  }

  .sentinel {
    height: 1px;
  }
</style>
