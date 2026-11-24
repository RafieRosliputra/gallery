<script lang="ts">
  // Google-Photos-style stage shared by the public and admin viewers:
  // - opens by zooming out of the clicked tile (FLIP from [data-asset-id])
  // - shows the already-cached 300px thumb instantly, fades the 1600px preview in
  // - prev/current/next live on one track: drag/swipe follows the finger, arrows slide
  // - swipe down to close, tap toggles the viewer chrome, neighbours are preloaded
  // - zoom: mouse wheel / trackpad pinch, touch pinch, double-tap or double-click,
  //   + - 0 keys; drag pans; the original file loads for detail; a minimap shows
  //   which part of the photo is on screen and can be dragged
  import { onMount } from 'svelte';
  import type { Asset } from '$lib/api/models';
  import Icon from './Icon.svelte';

  let {
    items,
    index,
    onstep,
    onclose,
    ontap = undefined,
    originalUrl = undefined,
    label = 'Photo'
  }: {
    items: Asset[];
    index: number;
    onstep: (delta: number) => void;
    onclose: () => void;
    ontap?: () => void;
    /** Full-resolution URL used once the photo is zoomed in. */
    originalUrl?: (asset: Asset) => string;
    label?: string;
  } = $props();

  let stageW = $state(0);
  let stageH = $state(0);
  let dx = $state(0);
  let dy = $state(0);
  let animating = $state(false);
  let loaded = $state<Record<string, boolean>>({});
  let stageEl: HTMLDivElement | undefined = $state();

  // Zoom state of the current slide: translate (zx, zy) then scale z, origin = box centre.
  let z = $state(1);
  let zx = $state(0);
  let zy = $state(0);
  let zoomAnim = $state(false);
  let hiRes = $state<Record<string, 'loading' | 'ready'>>({});

  const slides = $derived([-1, 0, 1].map((offset) => ({ offset, asset: items[index + offset] })));
  const current = $derived(items[index]);
  const hasPrev = $derived(index > 0);
  const hasNext = $derived(index >= 0 && index < items.length - 1);
  const dismiss = $derived(Math.min(1, Math.max(0, dy) / 300));
  const zoomed = $derived(z > 1.001);

  function fit(asset: Asset): { w: number; h: number } {
    if (!stageW || !stageH || !asset.w || !asset.h) return { w: stageW, h: stageH };
    const scale = Math.min(stageW / asset.w, stageH / asset.h);
    return { w: Math.round(asset.w * scale), h: Math.round(asset.h * scale) };
  }

  const box = $derived(current ? fit(current) : { w: stageW, h: stageH });
  // Allow at least 4×, and up to twice the original's 1:1 pixel size.
  const maxZoom = $derived(current && box.w ? Math.min(16, Math.max(4, (current.w / box.w) * 2)) : 4);

  // ---- zoom helpers ------------------------------------------------------------
  function clampPan(scale: number, x: number, y: number): { x: number; y: number } {
    const limitX = Math.max(0, (box.w * scale - stageW) / 2);
    const limitY = Math.max(0, (box.h * scale - stageH) / 2);
    return { x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) };
  }

  function setZoom(scale: number, x: number, y: number, animate = false): void {
    const next = Math.max(1, Math.min(maxZoom, scale));
    if (next <= 1.001) {
      z = 1;
      zx = 0;
      zy = 0;
    } else {
      const pan = clampPan(next, x, y);
      z = next;
      zx = pan.x;
      zy = pan.y;
      wantHiRes();
    }
    if (animate) {
      zoomAnim = true;
      window.setTimeout(() => (zoomAnim = false), 220);
    }
  }

  /** Zoom to `scale` keeping the photo point under (cx, cy) — stage-centre coords — still. */
  function zoomAt(scale: number, cx: number, cy: number, animate = false): void {
    const next = Math.max(1, Math.min(maxZoom, scale));
    const ratio = next / z;
    setZoom(next, cx - (cx - zx) * ratio, cy - (cy - zy) * ratio, animate);
  }

  function resetZoom(animate = false): void {
    setZoom(1, 0, 0, animate);
  }

  function fromCentre(clientX: number, clientY: number): { x: number; y: number } {
    const rect = stageEl?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  function wantHiRes(): void {
    const asset = current;
    if (!asset || !originalUrl || hiRes[asset.id]) return;
    hiRes = { ...hiRes, [asset.id]: 'loading' };
  }

  // A new photo always starts un-zoomed.
  $effect(() => {
    void index;
    z = 1;
    zx = 0;
    zy = 0;
  });

  // ---- slide animation -------------------------------------------------------
  const SLIDE_MS = 260;

  export function go(delta: number): void {
    if (animating) return;
    if ((delta < 0 && !hasPrev) || (delta > 0 && !hasNext)) {
      dx = 0;
      return;
    }
    if (zoomed) resetZoom();
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

  // ---- pointers: swipe, pan, pinch, tap / double-tap ------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; t: number; axis: 'x' | 'y' | null; id: number; zx: number; zy: number } | null =
    null;
  let moved = false;
  let pinch: { dist: number; z: number; mid: { x: number; y: number }; zx: number; zy: number } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;

  function pinchInfo(): { dist: number; mid: { x: number; y: number } } {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return { dist: 1, mid: { x: 0, y: 0 } };
    return {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2)
    };
  }

  function onpointerdown(event: PointerEvent): void {
    if (animating || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const info = pinchInfo();
      pinch = { dist: info.dist, z, mid: info.mid, zx, zy };
      start = null;
      if (dx !== 0 || dy !== 0) settle();
      return;
    }
    if (pointers.size > 2) return;
    start = { x: event.clientX, y: event.clientY, t: performance.now(), axis: null, id: event.pointerId, zx, zy };
    moved = false;
  }

  function onpointermove(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch && pointers.size >= 2) {
      const info = pinchInfo();
      const next = Math.max(1, Math.min(maxZoom, pinch.z * (info.dist / pinch.dist)));
      // Keep the photo point that was under the fingers' midpoint under the new midpoint.
      const px = (pinch.mid.x - pinch.zx) / pinch.z;
      const py = (pinch.mid.y - pinch.zy) / pinch.z;
      setZoom(next, info.mid.x - px * next, info.mid.y - py * next);
      return;
    }

    if (!start || event.pointerId !== start.id) return;
    const mx = event.clientX - start.x;
    const my = event.clientY - start.y;
    if (!start.axis && Math.hypot(mx, my) > 8) {
      start.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if (!start.axis) return;
    moved = true;
    if (zoomed) {
      const pan = clampPan(z, start.zx + mx, start.zy + my);
      zx = pan.x;
      zy = pan.y;
      return;
    }
    if (start.axis === 'x') {
      const edge = (mx > 0 && !hasPrev) || (mx < 0 && !hasNext);
      dx = edge ? mx * 0.3 : mx;
    } else {
      dy = Math.max(0, my);
    }
  }

  function onpointerup(event: PointerEvent): void {
    if (!pointers.delete(event.pointerId)) return;
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        if (z < 1.05) resetZoom(true);
      }
      start = null;
      return;
    }
    if (!start || event.pointerId !== start.id) return;
    const elapsed = Math.max(1, performance.now() - start.t);
    const axis = start.axis;
    const point = { x: event.clientX, y: event.clientY };
    start = null;
    if (!moved) {
      tapped(point);
      return;
    }
    if (zoomed) return;
    if (axis === 'x') {
      const fast = Math.abs(dx) / elapsed > 0.5;
      if ((Math.abs(dx) > stageW * 0.2 || fast) && dx !== 0) go(dx < 0 ? 1 : -1);
      else settle();
    } else if (axis === 'y') {
      if (dy > 120) onclose();
      else settle();
    }
  }

  function tapped(point: { x: number; y: number }): void {
    const now = performance.now();
    if (lastTap && now - lastTap.t < 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
      clearTimeout(tapTimer);
      lastTap = null;
      if (zoomed) resetZoom(true);
      else {
        const at = fromCentre(point.x, point.y);
        zoomAt(Math.min(maxZoom, 2.5), at.x, at.y, true);
      }
      return;
    }
    lastTap = { t: now, ...point };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => ontap?.(), 260);
  }

  // Wheel and trackpad pinch (ctrl+wheel) zoom around the cursor. Needs a
  // non-passive listener so the page does not scroll underneath.
  $effect(() => {
    const element = stageEl;
    if (!element) return;
    const onwheel = (event: WheelEvent) => {
      event.preventDefault();
      const speed = event.ctrlKey ? 0.01 : event.deltaMode === 1 ? 0.05 : 0.0025;
      const at = fromCentre(event.clientX, event.clientY);
      zoomAt(z * Math.exp(-event.deltaY * speed), at.x, at.y);
    };
    element.addEventListener('wheel', onwheel, { passive: false });
    return () => element.removeEventListener('wheel', onwheel);
  });

  // ---- keyboard ---------------------------------------------------------------
  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAt(z * 1.5, 0, 0, true);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomAt(z / 1.5, 0, 0, true);
    } else if (event.key === '0') {
      event.preventDefault();
      resetZoom(true);
    }
  }

  // ---- minimap ------------------------------------------------------------------
  const MINI = 132;
  const mini = $derived.by(() => {
    if (!box.w || !box.h) return { w: MINI, h: MINI };
    return box.w >= box.h ? { w: MINI, h: Math.round((MINI * box.h) / box.w) } : { w: Math.round((MINI * box.w) / box.h), h: MINI };
  });
  const view = $derived.by(() => {
    const width = box.w * z;
    const height = box.h * z;
    const left = stageW / 2 + zx - width / 2;
    const top = stageH / 2 + zy - height / 2;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const x0 = clamp(-left / width);
    const x1 = clamp((stageW - left) / width);
    const y0 = clamp(-top / height);
    const y1 = clamp((stageH - top) / height);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });

  function minimapMove(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    // Put photo point (fx, fy) at the stage centre.
    const pan = clampPan(z, box.w * z * (0.5 - fx), box.h * z * (0.5 - fy));
    zx = pan.x;
    zy = pan.y;
  }

  let miniDrag = false;
  function minidown(event: PointerEvent): void {
    event.stopPropagation();
    miniDrag = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    minimapMove(event);
  }
  function minimove(event: PointerEvent): void {
    event.stopPropagation();
    if (miniDrag) minimapMove(event);
  }
  function miniup(event: PointerEvent): void {
    event.stopPropagation();
    miniDrag = false;
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
    return () => clearTimeout(tapTimer);
  });
</script>

<svelte:window {onkeydown} />

<div
  class="stage"
  class:zoomed
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
          {@const size = fit(asset)}
          {@const isCurrent = slide.offset === 0}
          <div class="box" style:width={`${size.w}px`} style:height={`${size.h}px`}>
            <div
              class="zoomer"
              class:anim={zoomAnim}
              style:transform={isCurrent && zoomed ? `translate3d(${zx}px, ${zy}px, 0) scale(${z})` : undefined}
            >
              <img class="thumb" src={asset.thumbUrl} alt="" draggable="false" />
              <img
                class="preview"
                class:shown={loaded[asset.previewUrl]}
                src={asset.previewUrl}
                alt={isCurrent ? label : ''}
                draggable="false"
                onload={() => (loaded = { ...loaded, [asset.previewUrl]: true })}
              />
              {#if isCurrent && originalUrl && hiRes[asset.id]}
                <img
                  class="hires"
                  class:shown={hiRes[asset.id] === 'ready'}
                  src={originalUrl(asset)}
                  alt=""
                  draggable="false"
                  onload={() => (hiRes = { ...hiRes, [asset.id]: 'ready' })}
                />
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if hasPrev}
    <button type="button" class="nav left" aria-label="Previous photo" onpointerdown={(e) => e.stopPropagation()} onclick={() => go(-1)}>
      <Icon name="back" size={24} strokeWidth={2} />
    </button>
  {/if}
  {#if hasNext}
    <button type="button" class="nav right" aria-label="Next photo" onpointerdown={(e) => e.stopPropagation()} onclick={() => go(1)}>
      <Icon name="back" size={24} strokeWidth={2} />
    </button>
  {/if}

  {#if zoomed && current}
    <div class="minimap" aria-hidden="true">
      <div
        class="mini-img"
        role="presentation"
        style:width={`${mini.w}px`}
        style:height={`${mini.h}px`}
        onpointerdown={minidown}
        onpointermove={minimove}
        onpointerup={miniup}
        onpointercancel={miniup}
      >
        <img src={current.thumbUrl} alt="" draggable="false" />
        <span
          class="mini-view"
          style:left={`${view.x * 100}%`}
          style:top={`${view.y * 100}%`}
          style:width={`${view.w * 100}%`}
          style:height={`${view.h * 100}%`}
        ></span>
      </div>
      <div class="mini-bar">
        <span>{Math.round(z * 100)}%</span>
        {#if hiRes[current.id] === 'loading'}<span class="hd">memuat HD…</span>{:else if hiRes[current.id] === 'ready'}<span class="hd">HD</span>{/if}
        <button type="button" onpointerdown={(e) => e.stopPropagation()} onclick={() => resetZoom(true)}>Reset</button>
      </div>
    </div>
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
  .stage.zoomed {
    cursor: move;
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
  .zoomer {
    position: absolute;
    inset: 0;
    transform-origin: 50% 50%;
    will-change: transform;
  }
  .zoomer.anim {
    transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  .zoomer img {
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
  .preview,
  .hires {
    opacity: 0;
    transition: opacity 180ms ease-out;
  }
  .preview.shown,
  .hires.shown {
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
  .minimap {
    position: absolute;
    right: 12px;
    top: 76px;
    z-index: 3;
    padding: 6px;
    border-radius: 10px;
    background: rgb(20 22 24 / 0.82);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.45);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mini-img {
    position: relative;
    overflow: hidden;
    border-radius: 4px;
    cursor: pointer;
    touch-action: none;
  }
  .mini-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    opacity: 0.75;
  }
  .mini-view {
    position: absolute;
    border: 2px solid #fff;
    border-radius: 2px;
    box-shadow: 0 0 0 999px rgb(0 0 0 / 0.35);
    pointer-events: none;
  }
  .mini-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #e3e8ea;
  }
  .mini-bar .hd {
    color: #9fd8cf;
  }
  .mini-bar button {
    margin-left: auto;
    border: 0;
    border-radius: 10px;
    padding: 3px 8px;
    background: rgb(255 255 255 / 0.14);
    color: #fff;
    font-size: 12px;
    cursor: pointer;
  }
  @media (hover: none) {
    .nav {
      display: none;
    }
  }
  @media (max-width: 600px) {
    .minimap {
      top: 64px;
      right: 8px;
    }
  }
</style>
