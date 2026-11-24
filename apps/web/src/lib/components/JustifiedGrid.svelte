<script lang="ts">
  import type { Asset } from '$lib/api/models';
  import type { FavouritesStore } from '$lib/stores/favourites';
  import { justifiedRows } from '$lib/layout/justified';
  import Photo from './Photo.svelte';
  import Icon from './Icon.svelte';

  let {
    assets,
    targetRowHeight = 200,
    gap = 4,
    theme = 'dark',
    favourites = null,
    onopen = undefined,
    ariaLabel = 'Photo gallery'
  }: {
    assets: Asset[];
    targetRowHeight?: number;
    gap?: number;
    theme?: 'light' | 'dark';
    favourites?: FavouritesStore | null;
    onopen?: (id: string) => void;
    ariaLabel?: string;
  } = $props();

  let width = $state(0);

  const byId = $derived(new Map(assets.map((asset) => [asset.id, asset])));
  const rows = $derived(justifiedRows(assets, { width, targetRowHeight, gap }));
  const favouriteIds = $derived(new Set(favourites ? $favourites : []));
</script>

<div
  class="grid"
  bind:clientWidth={width}
  role="group"
  aria-label={ariaLabel}
  style:gap={`${gap}px`}
>
  {#each rows as row, rowIndex (rowIndex)}
    <div class="row" style:height={`${row.height}px`} style:gap={`${gap}px`}>
      {#each row.tiles as tile (tile.id)}
        {@const asset = byId.get(tile.id)}
        {#if asset}
          {#if onopen}
            <button
              type="button"
              class="tile"
              data-asset-id={tile.id}
              style:width={`${tile.width}px`}
              aria-label="Open photo"
              onclick={() => onopen?.(tile.id)}
            >
              <Photo {asset} {theme} />
              {#if favouriteIds.has(tile.id)}
                <span class="heart" aria-hidden="true"><Icon name="heart" size={18} fill="currentColor" /></span>
              {/if}
            </button>
          {:else}
            <div class="tile" data-asset-id={tile.id} style:width={`${tile.width}px`}>
              <Photo {asset} {theme} />
              {#if favouriteIds.has(tile.id)}
                <span class="heart" aria-hidden="true"><Icon name="heart" size={18} fill="currentColor" /></span>
              {/if}
            </div>
          {/if}
        {/if}
      {/each}
    </div>
  {/each}
  {#if width > 0 && assets.length === 0}
    <p class="empty">No photos.</p>
  {/if}
</div>

<style>
  .grid {
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    width: 100%;
    overflow: hidden;
  }

  .tile {
    position: relative;
    flex: none;
    padding: 0;
    border: 0;
    background: #2c3438;
    overflow: hidden;
    cursor: zoom-in;
  }

  .tile:hover :global(.image) {
    opacity: 0.9;
  }

  .heart {
    position: absolute;
    left: 8px;
    top: 8px;
    color: #fff;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.6));
    pointer-events: none;
  }

  .empty {
    padding: 24px 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
