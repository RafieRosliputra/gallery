<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { AlbumCard } from '$lib/api/models';
  import { copyText } from '$lib/clipboard';
  import { formatCount } from '$lib/format';
  import Icon from './Icon.svelte';
  import Photo from './Photo.svelte';

  let { album, onclose }: { album: AlbumCard; onclose: () => void } = $props();

  let copied = $state(false);
  let sheet: HTMLDivElement | undefined = $state();

  const url = $derived(typeof window === 'undefined' ? '' : `${window.location.origin}${base}/${album.slug}`);
  const cover = $derived(album.covers?.[0]);

  onMount(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    sheet?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  });

  async function copy() {
    copied = await copyText(url);
    if (copied) window.setTimeout(() => (copied = false), 2500);
  }

  async function other() {
    if (navigator.share) {
      try {
        await navigator.share({ title: album.title, text: album.title, url });
        onclose();
      } catch {
        // User cancelled or share failed; keep the sheet open.
      }
      return;
    }
    await copy();
  }

  const whatsapp = $derived(`https://wa.me/?text=${encodeURIComponent(`${album.title} — ${url}`)}`);
</script>

<div class="backdrop">
  <button type="button" class="scrim" aria-label="Tutup" onclick={onclose}></button>
  <div role="dialog" aria-modal="true" aria-labelledby="share-title" class="sheet" tabindex="-1" bind:this={sheet}>
    <span class="handle" aria-hidden="true"></span>
    <div class="album">
      <span class="cover">{#if cover}<Photo asset={cover} />{/if}</span>
      <div class="titles">
        <h2 id="share-title">Kongsi "{album.title}"</h2>
        <span>{formatCount(album.assetCount)} gambar{album.cameras.length > 1 ? ` · ${album.cameras.length} kamera` : ''}</span>
      </div>
    </div>

    <div class="link">
      <span class="url">johorstudio.com/s/<em>{album.slug}</em></span>
      <button type="button" class="copy" onclick={copy}>{copied ? 'Disalin' : 'Salin'}</button>
    </div>

    <div class="actions">
      <a href={whatsapp} class="action" rel="nofollow">
        <Icon name="whatsapp" size={22} />
        WhatsApp
      </a>
      <button type="button" class="action" onclick={other}>
        <Icon name="share" size={22} />
        Lain-lain
      </button>
    </div>

    <p class="note">Penerima nampak album ni sahaja. Album lain {album.clientName} tak kelihatan.</p>
    <span class="sr-only" role="status">{copied ? 'Link disalin' : ''}</span>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 0.55);
  }

  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: default;
  }

  .sheet:focus {
    outline: none;
  }

  .sheet {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 520px;
    background: #1f2528;
    border-radius: 16px 16px 0 0;
    padding: 10px 20px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--text);
    box-shadow: 0 -12px 40px rgb(0 0 0 / 0.5);
  }

  .handle {
    align-self: center;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: #46525a;
  }

  .album {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .cover {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 8px;
    background: #5d5650;
    flex: none;
    overflow: hidden;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .titles h2 {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  .titles span {
    font-size: 13px;
    color: var(--muted);
  }

  .link {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--public-bg);
    border: 1px solid #2f383d;
    border-radius: 8px;
    padding: 0 6px 0 12px;
    height: 52px;
  }

  .url {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url em {
    font-style: normal;
    color: var(--teal);
    font-weight: 600;
  }

  .copy {
    height: 40px;
    padding: 0 14px;
    border: 0;
    border-radius: 20px;
    background: var(--teal);
    color: #10201e;
    font-size: 14px;
    font-weight: 600;
    flex: none;
  }

  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .action {
    height: 76px;
    border: 0;
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .action:hover {
    background: #30383d;
  }

  .note {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--muted);
  }
</style>
