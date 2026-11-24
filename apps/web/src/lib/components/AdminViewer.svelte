<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import Icon from './Icon.svelte';

  // Admin lightbox: preview 1600px, prev/next across the list it was opened from,
  // keyboard ← → Esc, and a link to the original (admin session may always download).
  let { items, id, onclose, onchange }: {
    items: Asset[];
    id: string;
    onclose: () => void;
    onchange: (id: string) => void;
  } = $props();

  const index = $derived(items.findIndex((item) => item.id === id));
  const current = $derived(index >= 0 ? items[index] : undefined);
  const prev = $derived(index > 0 ? items[index - 1] : undefined);
  const next = $derived(index >= 0 && index < items.length - 1 ? items[index + 1] : undefined);
  let closeButton: HTMLButtonElement | undefined = $state();

  function onkey(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose();
    else if (event.key === 'ArrowLeft' && prev) onchange(prev.id);
    else if (event.key === 'ArrowRight' && next) onchange(next.id);
  }

  onMount(() => closeButton?.focus());
</script>

<svelte:window onkeydown={onkey} />

{#if current}
  <div class="backdrop" role="dialog" aria-modal="true" aria-label="Lihat gambar">
    <div class="bar">
      <span class="count">{index + 1} / {items.length}</span>
      <div class="actions">
        <a class="action" href={api.originalUrl(current.id)} download aria-label="Download fail asal">
          <Icon name="download" size={22} />
        </a>
        <button type="button" class="action" aria-label="Tutup" bind:this={closeButton} onclick={onclose}>
          <Icon name="close" size={22} />
        </button>
      </div>
    </div>
    <div class="stage">
      {#key current.id}
        <img src={current.previewUrl} alt="" />
      {/key}
      {#if prev}
        <button type="button" class="nav left" aria-label="Gambar sebelum" onclick={() => onchange(prev.id)}>
          <Icon name="back" size={24} />
        </button>
      {/if}
      {#if next}
        <button type="button" class="nav right" aria-label="Gambar seterusnya" onclick={() => onchange(next.id)}>
          <Icon name="back" size={24} />
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #000000;
    color: #ffffff;
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
  }
  .count {
    font-size: 14px;
    color: #c3ccce;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .action {
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: 24px;
    background: transparent;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .action:hover,
  .nav:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .nav {
    position: absolute;
    top: 50%;
    width: 52px;
    height: 52px;
    margin-top: -26px;
    border: 0;
    border-radius: 26px;
    background: rgba(17, 21, 23, 0.6);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .nav.left {
    left: 12px;
  }
  .nav.right {
    right: 12px;
    transform: scaleX(-1);
  }
</style>
