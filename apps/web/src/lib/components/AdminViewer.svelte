<script lang="ts">
  import { onMount } from 'svelte';
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import type { Asset } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatClock, formatDayLabel } from '$lib/format';
  import Icon from './Icon.svelte';
  import PhotoStage from './PhotoStage.svelte';

  // Admin lightbox in the Google Photos style: zooms out of the tile, swipe/drag or
  // ← → to move, swipe down / Esc / browser Back to close, chrome hides when idle.
  let { items, id, onclose, onchange }: {
    items: Asset[];
    id: string;
    onclose: () => void;
    onchange: (id: string) => void;
  } = $props();

  const index = $derived(items.findIndex((item) => item.id === id));
  const current = $derived(index >= 0 ? items[index] : undefined);
  let chrome = $state(true);
  let pushed = $state(false);
  let idle: number | undefined;

  function wake(): void {
    chrome = true;
    window.clearTimeout(idle);
    idle = window.setTimeout(() => (chrome = false), 2500);
  }

  function toggleChrome(): void {
    if (chrome) {
      window.clearTimeout(idle);
      chrome = false;
    } else {
      wake();
    }
  }

  function close(): void {
    if (page.state.adminViewer) history.back();
    else onclose();
  }

  function step(delta: number): void {
    const next = items[index + delta];
    if (next) onchange(next.id);
  }

  onMount(() => {
    pushState('', { adminViewer: true });
    pushed = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    wake();
    return () => {
      window.clearTimeout(idle);
      document.body.style.overflow = overflow;
    };
  });

  // Browser Back (or close()) popped our history entry → close the viewer.
  $effect(() => {
    if (pushed && !page.state.adminViewer) onclose();
  });

  function onkey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onkey} onmousemove={wake} />

{#if current}
  <div class="backdrop" role="dialog" aria-modal="true" aria-label="Lihat gambar">
    <PhotoStage
      {items}
      {index}
      onstep={step}
      onclose={close}
      ontap={toggleChrome}
      label={`Gambar ${index + 1} daripada ${items.length}`}
    />
    <div class="bar" class:hidden={!chrome}>
      <button type="button" class="action" aria-label="Tutup" onclick={close}>
        <Icon name="back" size={22} />
      </button>
      <div class="info">
        {#if current.takenAt}
          <span class="when">{formatDayLabel(current.takenAt)} · {formatClock(current.takenAt)}</span>
        {/if}
        <span class="meta count">{index + 1} / {items.length}{current.camera ? ` · ${current.camera}` : ''}</span>
      </div>
      <a class="action" href={api.originalUrl(current.id)} download aria-label="Download fail asal">
        <Icon name="download" size={22} />
      </a>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #000;
    color: #fff;
    display: flex;
    flex-direction: column;
  }
  .bar {
    position: absolute;
    z-index: 2;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 28px;
    background: linear-gradient(rgb(0 0 0 / 0.6), rgb(0 0 0 / 0));
    transition: opacity 200ms ease-out;
  }
  .bar.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .when {
    font-size: 15px;
    font-weight: 600;
  }
  .meta {
    font-size: 13px;
    color: #c3ccce;
  }
  .action {
    width: 48px;
    height: 48px;
    flex: none;
    border: 0;
    border-radius: 24px;
    background: transparent;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .action:hover {
    background: rgb(255 255 255 / 0.12);
  }
</style>
