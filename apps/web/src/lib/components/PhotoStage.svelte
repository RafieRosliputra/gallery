<script lang="ts">
  // Google-Photos-style stage shared by the public and admin viewers:
  // - opens by zooming out of the clicked tile (FLIP from [data-asset-id])
  // - shows the already-cached 300px thumb instantly, fades the 1600px preview in
  // - prev/current/next live on one track: drag/swipe follows the finger, arrows slide
  // - swipe down to close, tap toggles the viewer chrome, neighbours are preloaded
  import { onMount } from 'svelte';
  import type { Asset } from '$lib/api/models';
  import Icon from './Icon.svelte';

  let {
    items,
    index,
    onstep,
    onclose,
    ontap = undefined,
    label = 'Gambar'
  }: {
    items: Asset[];
    index: number;
    onstep: (delta: number) => void;
    onclose: () => void;
    ontap?: () => void;
    label?: string;
  } = $props();

  let stageW = $state(0);
  let stageH = $state(0);
  let dx = $state(0);
  let dy = $state(0);
  let animating = $state(false);
  let loaded = $state<Record<string, boolean>>({});
  let stageEl: HTMLDivElement | undefined = $state();

  const slides = $derived([-1, 0, 1].map((offset) => ({ offset, asset: items[index + offset] })));
  const hasPrev = $derived(index > 0);
  const hasNext = $derived(index >= 0 && index < items.length - 1);
  const dismiss = $derived(Math.min(1, Math.max(0, dy) / 300));

  function fit(asset: Asset): { w: number; h: number } {
    if (!stageW || !stageH || !asset.w || !asset.h) return { w: stageW, h: stageH };
    const scale = Math.min(stageW / asset.w, stageH / asset.h);
    return { w: Math.round(asset.w * scale), h: Math.round(asset.h * scale) };
  }

  // ---- slide animation -------------------------------------------------------
  const SLIDE_MS = 260;

  export function go(delta: number): void {
    if (animating) return;
    if ((delta < 0 && !hasPrev) || (delta > 0 && !hasNext)) {
      dx = 0;
      return;
    }
    animating = true;
    dx = -delta * stageW;
    window.setTimeout(() => {
      animating = false;
      dx = 0;
      onstep(delta);
    }, SLIDE_MS);
  }

  function settle(): void {
    animating = true;
    dx = 0;
    dy = 0;
    window.setTimeout(() => (animating = false), SLIDE_MS);
  }

  // ---- pointer drag ----------------------------------------------------------
  let start: { x: number; y: number; t: number; axis: 'x' | 'y' | null; id: number } | null = null;
  let moved = false;

  function onpointerdown(event: PointerEvent): void {
    if (animating || (event.pointerType === 'mouse' && event.button !== 0)) return;
    start = { x: event.clientX, y: event.clientY, t: performance.now(), axis: null, id: event.pointerId };
    moved = false;
  }

  function onpointermove(event: PointerEvent): void {
    if (!start || event.pointerId !== start.id) return;
    const mx = event.clientX - start.x;
    const my = event.clientY - start.y;
    if (!start.axis && Math.hypot(mx, my) > 8) {
      start.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if (!start.axis) return;
    moved = true;
    if (start.axis === 'x') {
      const edge = (mx > 0 && !hasPrev) || (mx < 0 && !hasNext);
      dx = edge ? mx * 0.3 : mx;
    } else {
      dy = Math.max(0, my);
    }
  }

  function onpointerup(event: PointerEvent): void {
    if (!start || event.pointerId !== start.id) return;
    const elapsed = Math.max(1, performance.now() - start.t);
    const axis = start.axis;
    start = null;
    if (!moved) {
      ontap?.();
      return;
    }
    if (axis === 'x') {
      const fast = Math.abs(dx) / elapsed > 0.5;
      if ((Math.abs(dx) > stageW * 0.2 || fast) && dx !== 0) go(dx < 0 ? 1 : -1);
      else settle();
    } else if (axis === 'y') {
      if (dy > 120) onclose();
      else settle();
    }
  }

  // ---- keyboard ---------------------------------------------------------------
  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    }
  }

  // ---- preload neighbours ----------------------------------------------------
  $effect(() => {
    for (const offset of [-2, -1, 1, 2]) {
      const neighbour = items[index + offset];
      if (neighbour) {
        const image = new Image();
        image.src = neighbour.previewUrl;
      }
    }
  });

  // ---- open: zoom out of the tile that was clicked -----------------------------
  onMount(() => {
    const asset = items[index];
    if (!asset) return;
    const tile = document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(asset.id)}"]`);
    if (!tile) return;
    const from = tile.getBoundingClientRect();
    let frames = 0;
    const attempt = () => {
      const currentBox = stageEl?.querySelector<HTMLElement>('.slide.current .box');
      const to = currentBox?.getBoundingClientRect();
      if (!currentBox || !to || !to.width || !to.height) {
        if (++frames < 10) requestAnimationFrame(attempt);
        return;
      }
      if (!from.width) return;
      currentBox.animate(
        [
          {
            transformOrigin: '0 0',
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
          },
          { transformOrigin: '0 0', transform: 'none' }
        ],
        { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      );
    };
    requestAnimationFrame(attempt);
  });
</script>

<svelte:window {onkeydown} />

<div
  class="stage"
  role="group"
  aria-label={label}
  bind:this={stageEl}
  bind:clientWidth={stageW}
  bind:clientHeight={stageH}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  style:opacity={1 - dismiss * 0.6}
>
  <div
    class="track"
    class:animating
    style:transform={`translate3d(${dx - stageW}px, ${dy}px, 0) scale(${1 - dismiss * 0.15})`}
  >
    {#each slides as slide (slide.asset?.id ?? `empty${slide.offset}`)}
      <div class="slide" class:current={slide.offset === 0} style:left={`${(slide.offset + 1) * stageW}px`} style:width={`${stageW}px`}>
        {#if slide.asset}
          {@const asset = slide.asset}
          {@const box = fit(asset)}
          <div class="box" style:width={`${box.w}px`} style:height={`${box.h}px`}>
            <img class="thumb" src={asset.thumbUrl} alt="" draggable="false" />
            <img
              class="preview"
              class:shown={loaded[asset.previewUrl]}
              src={asset.previewUrl}
              alt={slide.offset === 0 ? label : ''}
              draggable="false"
              onload={() => (loaded = { ...loaded, [asset.previewUrl]: true })}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if hasPrev}
    <button type="button" class="nav left" aria-label="Gambar sebelum" onpointerdown={(e) => e.stopPropagation()} onclick={() => go(-1)}>
      <Icon name="back" size={24} strokeWidth={2} />
    </button>
  {/if}
  {#if hasNext}
    <button type="button" class="nav right" aria-label="Gambar seterusnya" onpointerdown={(e) => e.stopPropagation()} onclick={() => go(1)}>
      <Icon name="back" size={24} strokeWidth={2} />
    </button>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    user-select: none;
    cursor: grab;
  }
  .stage:active {
    cursor: grabbing;
  }
  .track {
    position: absolute;
    inset: 0;
    will-change: transform;
  }
  .track.animating {
    transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
  }
  .slide {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .box {
    position: relative;
  }
  .box img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    -webkit-user-drag: none;
  }
  .thumb {
    filter: blur(0.5px);
  }
  .preview {
    opacity: 0;
    transition: opacity 180ms ease-out;
  }
  .preview.shown {
    opacity: 1;
  }
  .nav {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 18%;
    max-width: 140px;
    border: 0;
    background: transparent;
    color: #fff;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 150ms ease-out;
    cursor: pointer;
  }
  .nav :global(svg) {
    width: 48px;
    height: 48px;
    padding: 12px;
    border-radius: 50%;
    background: rgb(32 33 36 / 0.7);
    box-sizing: border-box;
  }
  .nav.left {
    left: 0;
    justify-content: flex-start;
    padding-left: 16px;
  }
  .nav.right {
    right: 0;
    justify-content: flex-end;
    padding-right: 16px;
  }
  .nav.right :global(svg) {
    transform: scaleX(-1);
  }
  .stage:hover .nav,
  .nav:focus-visible {
    opacity: 1;
  }
  @media (hover: none) {
    .nav {
      display: none;
    }
  }
</style>
