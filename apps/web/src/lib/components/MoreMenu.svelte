<script lang="ts">
  import Icon from './Icon.svelte';
  import type { MenuItem } from './menu';

  let {
    open,
    onclose,
    items,
    label = 'Lagi'
  }: {
    open: boolean;
    onclose: () => void;
    items: MenuItem[];
    label?: string;
  } = $props();

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if open}
  <button type="button" class="scrim" aria-label="Tutup menu" onclick={onclose}></button>
  <div class="panel" role="menu" aria-label={label}>
    {#each items as item (item.label)}
      {#if item.href}
        <a role="menuitem" href={item.href} onclick={onclose}>
          <Icon name={item.icon} size={20} />
          {item.label}
        </a>
      {:else}
        <button
          type="button"
          role="menuitem"
          onclick={() => {
            item.onclick?.();
            onclose();
          }}
        >
          <Icon name={item.icon} size={20} />
          {item.label}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: default;
  }

  .panel {
    position: absolute;
    right: 20px;
    top: calc(100% + 6px);
    z-index: 21;
    width: 260px;
    background: var(--surface);
    border-radius: 8px;
    padding: 6px 0;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    font-size: 15px;
  }

  .panel a,
  .panel button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 15px;
  }

  .panel a:hover,
  .panel button:hover {
    background: #30383d;
  }

  @media (max-width: 600px) {
    .panel {
      right: 8px;
    }
  }
</style>
