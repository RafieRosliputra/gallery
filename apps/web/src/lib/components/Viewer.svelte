<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { AlbumCard, Asset } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { copyText } from '$lib/clipboard';
  import { formatCount } from '$lib/format';
  import type { FavouritesStore } from '$lib/stores/favourites';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import MoreMenu from './MoreMenu.svelte';
  import type { MenuItem } from './menu';
  import Photo from './Photo.svelte';

  let {
    items,
    id,
    album,
    allowDownload,
    favourites,
    total = album.assetCount,
    onclose,
    onchange,
    ontoggle
  }: {
    items: Asset[];
    id: string;
    album: AlbumCard;
    allowDownload: boolean;
    favourites: FavouritesStore;
    total?: number;
    onclose: () => void;
    onchange: (id: string) => void;
    ontoggle?: (id: string) => void;
  } = $props();

  let menuOpen = $state(false);
  let toast = $state('');
  let touchStart = $state<{ x: number; y: number } | null>(null);
  let dialog: HTMLDivElement | undefined = $state();

  const index = $derived(items.findIndex((item) => item.id === id));
  const active = $derived(items[index] ?? items[0]);
  const isFav = $derived(active ? $favourites.includes(active.id) : false);

  const strip = $derived.by(() => {
    if (!items.length) return [];
    const size = Math.min(7, items.length);
    const start = Math.max(0, Math.min(index - 3, items.length - size));
    return items.slice(start, start + size);
  });

  const shareUrl = $derived(
    typeof window === 'undefined' || !active
      ? ''
      : `${window.location.origin}${base}/${album.slug}?p=${encodeURIComponent(active.id)}`
  );

  const menu: MenuItem[] = [
    { label: 'Salin link gambar', icon: 'link', onclick: () => void share() },
    { label: 'Pergi ke JohorStudio.com', icon: 'globe', href: 'https://johorstudio.com' }
  ];

  onMount(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (menuOpen) menuOpen = false;
        else onclose();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  });

  $effect(() => {
    // Preload neighbours so swiping feels immediate.
    for (const offset of [-1, 1]) {
      const neighbour = items[index + offset];
      if (neighbour) {
        const image = new Image();
        image.src = neighbour.previewUrl;
      }
    }
  });

  function step(delta: number) {
    const next = items[index + delta];
    if (next) onchange(next.id);
  }

  function onTouchStart(event: TouchEvent) {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent) {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) step(dx < 0 ? 1 : -1);
  }

  async function share() {
    if (!active) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: album.title, url: shareUrl });
        return;
      } catch {
        // User cancelled; fall through is wrong, so stop here.
        return;
      }
    }
    const ok = await copyText(shareUrl);
    toast = ok ? 'Link disalin' : 'Gagal salin link';
    window.setTimeout(() => (toast = ''), 2500);
  }
</script>

<div
  class="viewer"
  role="dialog"
  aria-modal="true"
  aria-label="Lihat gambar"
  tabindex="-1"
  bind:this={dialog}
>
  <header class="bar">
    <button type="button" class="back" aria-label="Kembali ke galeri" onclick={onclose}>
      <Icon name="back" size={22} strokeWidth={2} />
    </button>
    <div class="actions">
      <IconButton label="Kongsi gambar" name="share" size={21} hit={44} onclick={share} />
      <button
        type="button"
        class="icon-button"
        aria-label={isFav ? 'Buang dari favourite' : 'Tambah ke favourite'}
        aria-pressed={isFav}
        class:fav={isFav}
        style:width="44px"
        style:height="44px"
        onclick={() => active && (ontoggle ? ontoggle(active.id) : favourites.toggle(active.id))}
      >
        <Icon name="heart" size={22} fill={isFav ? 'currentColor' : 'none'} />
      </button>
      {#if allowDownload && active}
        <a class="icon-button" href={active.original ?? api.originalUrl(active.id, album.slug)} download aria-label="Download gambar ni" title="Download gambar ni">
          <Icon name="download" size={23} />
        </a>
      {/if}
      <IconButton label="Lagi" name="more" size={21} hit={44} active={menuOpen} onclick={() => (menuOpen = !menuOpen)} />
    </div>
    <MoreMenu open={menuOpen} onclose={() => (menuOpen = false)} items={menu} />
  </header>

  <div class="stage" role="group" aria-label="Gambar" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
    {#if active}
      <img
        src={active.previewUrl}
        alt={`Gambar ${index + 1} daripada ${formatCount(total)}`}
        class="full"
        draggable="false"
      />
    {:else}
      <p class="missing">Gambar tak dijumpai.</p>
    {/if}
  </div>

  <div class="bottom">
    <span class="counter">{active ? formatCount(index + 1) : '0'} / {formatCount(total)}</span>
    <div class="strip" role="group" aria-label="Gambar berdekatan">
      {#each strip as item (item.id)}
        <button
          type="button"
          class="thumb"
          class:current={item.id === active?.id}
          aria-label={`Buka gambar ${item.id}`}
          aria-current={item.id === active?.id ? 'true' : undefined}
          onclick={() => onchange(item.id)}
        >
          <Photo asset={item} />
        </button>
      {/each}
    </div>
    {#if toast}<span class="toast" role="status">{toast}</span>{/if}
  </div>
</div>

<style>
  .viewer:focus {
    outline: none;
  }

  .viewer {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #000;
    color: #fff;
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px;
    position: relative;
  }

  .back,
  .icon-button {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: #fff;
  }

  .back:hover,
  .icon-button:hover {
    background: rgb(255 255 255 / 0.1);
  }

  .icon-button.fav {
    color: var(--fav);
  }

  .actions {
    display: flex;
    align-items: center;
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    touch-action: pan-y;
    user-select: none;
  }

  .full {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .missing {
    color: var(--muted);
    font-size: 14px;
  }

  .bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 8px 8px calc(24px + env(safe-area-inset-bottom));
    position: relative;
  }

  .counter {
    font-size: 13px;
    color: #c3ccce;
  }

  .strip {
    display: flex;
    gap: 3px;
    overflow: hidden;
    max-width: 100%;
  }

  .thumb {
    position: relative;
    flex: 0 0 48px;
    height: 48px;
    padding: 0;
    border: 0;
    background: #262d31;
    opacity: 0.55;
    overflow: hidden;
  }

  .thumb.current {
    opacity: 1;
    outline: 2px solid #fff;
    outline-offset: -2px;
  }

  .toast {
    position: absolute;
    bottom: calc(100% + 6px);
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }

  @media (min-width: 760px) {
    .bar {
      padding: 12px 16px;
    }

    .full {
      max-height: calc(100dvh - 190px);
    }

    .bottom {
      padding-bottom: 18px;
    }
  }
</style>
