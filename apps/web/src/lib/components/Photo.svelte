<script lang="ts">
  import { thumbHashToDataURL } from 'thumbhash';
  import type { AssetItem } from '@gallery/shared';

  let {
    asset,
    mode = 'thumb',
    theme = 'dark',
    alt = '',
    eager = false
  }: {
    asset: AssetItem;
    mode?: 'thumb' | 'preview';
    theme?: 'light' | 'dark';
    alt?: string;
    eager?: boolean;
  } = $props();

  let loaded = $state(false);
  let failed = $state(false);

  const src = $derived(mode === 'preview' ? asset.previewUrl : asset.thumbUrl);

  const placeholder = $derived.by(() => {
    if (!asset.thumbhash) return null;
    try {
      const binary = atob(asset.thumbhash);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return thumbHashToDataURL(bytes);
    } catch {
      return null;
    }
  });

  const fallback = $derived.by(() => {
    let hash = 0;
    for (let i = 0; i < asset.id.length; i += 1) hash = (hash * 31 + asset.id.charCodeAt(i)) % 360;
    const lightness = theme === 'light' ? 78 : 34;
    const saturation = theme === 'light' ? 7 : 9;
    return `hsl(${hash} ${saturation}% ${lightness}%)`;
  });
</script>

<div class="photo" style:background={fallback}>
  {#if placeholder}
    <img class="placeholder" src={placeholder} alt="" aria-hidden="true" draggable="false" />
  {/if}
  {#if !failed}
    <img
      class="image"
      class:loaded
      src={src}
      {alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable="false"
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
  {/if}
</div>

<style>
  .photo {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .placeholder,
  .image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder {
    filter: blur(10px);
    transform: scale(1.08);
  }

  .image {
    opacity: 0;
    transition: opacity 240ms ease;
  }

  .image.loaded {
    opacity: 1;
  }
</style>
