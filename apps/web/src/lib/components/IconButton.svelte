<script lang="ts">
  import Icon from './Icon.svelte';

  type IconName = 'grid' | 'albums' | 'link' | 'pulse' | 'search' | 'refresh' | 'share' | 'heart' | 'download' | 'more' | 'back' | 'close' | 'whatsapp' | 'copy' | 'trash' | 'globe' | 'check';

  let {
    label,
    name,
    size = 22,
    hit = 48,
    active = false,
    onclick
  }: {
    label: string;
    name: IconName;
    size?: number;
    hit?: number;
    active?: boolean;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class="icon-button"
  class:active
  aria-label={label}
  title={label}
  style:width={`${hit}px`}
  style:height={`${hit}px`}
  {onclick}
>
  <Icon {name} {size} />
</button>

<style>
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: currentColor;
    transition: background 140ms ease;
  }

  .icon-button:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .icon-button.active {
    background: var(--surface);
  }
</style>
