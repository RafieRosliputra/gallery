<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { AlbumResponse, Asset } from '$lib/api/models';
  import { api, downloadBlob } from '$lib/api/client';
  import { formatCount, formatShortDate } from '$lib/format';
  import { getFavourites } from '$lib/stores/favourites';
  import { openedFromClient } from '$lib/routing/back';
  import BucketVirtualList from '$lib/components/BucketVirtualList.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import JustifiedGrid from '$lib/components/JustifiedGrid.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import ShareSheet from '$lib/components/ShareSheet.svelte';
  import Viewer from '$lib/components/Viewer.svelte';
  import type { MenuItem } from '$lib/components/menu';

  let { data }: { data: AlbumResponse } = $props();

  const album = $derived(data.album);
  const cameras = $derived(data.cameras);
  const favourites = $derived(getFavourites(album.slug));
  const favIds = $derived($favourites);

  const camParam = $derived(page.url.searchParams.get('cam'));
  const activeCam = $derived(camParam && cameras.some((camera) => camera.camera === camParam) ? camParam : null);
  const viewerId = $derived(page.url.searchParams.get('p'));
  const favMode = $derived(page.url.searchParams.get('fav') === '1');
  const backSlug = $derived(openedFromClient(album.slug));
  const back = $derived(backSlug && data.client && backSlug === data.client.slug ? data.client : null);
  const shareOpen = $derived(page.url.searchParams.get('share') === '1');

  let menuOpen = $state(false);
  let itemsByBucket = $state<Record<string, Asset[]>>({});
  let directAssets = $state<Record<string, Asset>>({});
  let favAssets = $state<Asset[]>([]);
  let toast = $state('');
  let zipBusy = $state(false);
  let viewerPushed = $state(false);
  let favPushed = $state(false);

  $effect(() => {
    if (!viewerId) viewerPushed = false;
  });

  $effect(() => {
    if (!favMode) favPushed = false;
  });

  const loaded = $derived.by(() => {
    const map = new Map<string, Asset>();
    for (const bucket of data.buckets) {
      for (const item of itemsByBucket[`${activeCam ?? 'all'}:${bucket.key}`] ?? []) {
        map.set(item.id, item);
      }
    }
    return map;
  });

  const viewerItems = $derived.by(() => {
    if (favMode) {
      const list = [...favAssets];
      if (viewerId && !list.some((item) => item.id === viewerId) && directAssets[viewerId]) {
        list.push(directAssets[viewerId]);
      }
      return list;
    }
    const list = [...loaded.values()];
    if (viewerId && !list.some((item) => item.id === viewerId) && directAssets[viewerId]) {
      list.unshift(directAssets[viewerId]);
    }
    return list;
  });

  const viewerTotal = $derived(favMode ? Math.max(favIds.length, viewerItems.length) : album.assetCount);

  $effect(() => {
    const id = viewerId;
    if (!id) return;
    if (loaded.has(id) || directAssets[id]) return;
    let cancelled = false;
    api
      .getAsset(id)
      .then((response) => {
        if (!cancelled) directAssets = { ...directAssets, [id]: response.asset };
      })
      .catch(() => {
        if (!cancelled) toast = 'Gambar tak dijumpai.';
      });
    return () => {
      cancelled = true;
    };
  });

  let favFetchKey = '';
  $effect(() => {
    if (!favMode) return;
    const ids = favIds;
    const cached = new Map<string, Asset>();
    for (const item of loaded.values()) cached.set(item.id, item);
    for (const [key, item] of Object.entries(directAssets)) cached.set(key, item);
    const missing = ids.filter((id) => !cached.has(id));
    const key = ids.join(',');
    if (key === favFetchKey && missing.length === 0) {
      favAssets = ids.map((id) => cached.get(id)).filter((item): item is Asset => Boolean(item));
      return;
    }
    favFetchKey = key;
    if (missing.length === 0) {
      favAssets = ids.map((id) => cached.get(id)).filter((item): item is Asset => Boolean(item));
      return;
    }
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        try {
          return (await api.getAsset(id)).asset;
        } catch {
          return null;
        }
      })
    ).then((fetched) => {
      if (cancelled) return;
      const merged = new Map(cached);
      for (const item of fetched) if (item) merged.set(item.id, item);
      favAssets = ids.map((id) => merged.get(id)).filter((item): item is Asset => Boolean(item));
    });
    return () => {
      cancelled = true;
    };
  });

  const menu = $derived.by<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    if (favMode) {
      if (album.allowDownload && favIds.length > 0) {
        items.push({
          label: `Download favourite (ZIP)`,
          icon: 'download',
          onclick: () => void downloadFavourites()
        });
      }
      if (favIds.length > 0) {
        items.push({ label: 'Kosongkan senarai', icon: 'trash', onclick: () => favourites.clear() });
      }
    } else if (album.allowDownload && favIds.length > 0) {
      items.push({
        label: `Download favourite (ZIP)`,
        icon: 'download',
        onclick: () => void downloadFavourites()
      });
    }
    items.push({ label: 'Pergi ke JohorStudio.com', icon: 'globe', href: 'https://johorstudio.com' });
    return items;
  });

  function urlWith(patch: Record<string, string | null>): string {
    const params = new URLSearchParams(page.url.searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    return `${base}/${album.slug}${query ? `?${query}` : ''}`;
  }

  async function openViewer(id: string) {
    viewerPushed = true;
    await goto(urlWith({ p: id }), { noScroll: true, keepFocus: true });
  }

  function closeViewer() {
    if (viewerPushed) window.history.back();
    else void goto(urlWith({ p: null }), { replaceState: true, noScroll: true });
  }

  function changeViewer(id: string) {
    void goto(urlWith({ p: id }), { replaceState: true, noScroll: true, keepFocus: true });
  }

  async function openFavourites() {
    favPushed = true;
    await goto(urlWith({ fav: '1' }), { noScroll: true, keepFocus: true });
  }

  function closeFavourites() {
    if (favPushed) window.history.back();
    else void goto(urlWith({ fav: null }), { replaceState: true, noScroll: true });
  }

  function setCam(value: string | null) {
    void goto(urlWith({ cam: value }), { noScroll: true, keepFocus: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openShare() {
    if (navigator.share) {
      void navigator.share({ title: album.title, url: `${window.location.origin}${base}/${album.slug}` }).catch(() => {});
      return;
    }
    void goto(urlWith({ share: '1' }), { replaceState: true, noScroll: true, keepFocus: true });
  }

  function closeShare() {
    void goto(urlWith({ share: null }), { replaceState: true, noScroll: true });
  }

  function onBucketLoaded(cacheKey: string, items: Asset[]) {
    const next = { ...itemsByBucket, [cacheKey]: items };
    itemsByBucket = next;
  }

  async function downloadAll() {
    if (!album.allowDownload || zipBusy) return;
    zipBusy = true;
    toast = 'Menyediakan ZIP…';
    try {
      const blob = await api.zip({ albumSlug: album.slug, cam: activeCam ?? undefined });
      downloadBlob(blob, `${album.slug}.zip`);
      toast = 'Download bermula.';
    } catch {
      toast = 'ZIP gagal disediakan.';
    } finally {
      zipBusy = false;
      window.setTimeout(() => (toast = ''), 3000);
    }
  }

  async function downloadFavourites() {
    if (!album.allowDownload || zipBusy || favIds.length === 0) return;
    zipBusy = true;
    toast = 'Menyediakan ZIP favourite…';
    try {
      const blob = await api.zip({ albumSlug: album.slug, ids: favIds });
      downloadBlob(blob, `favourite-${album.slug}.zip`);
      toast = 'Download bermula.';
    } catch {
      toast = 'ZIP gagal disediakan.';
    } finally {
      zipBusy = false;
      window.setTimeout(() => (toast = ''), 3000);
    }
  }

  function toggleFavourite(id: string) {
    const added = favourites.toggle(id);
    if (favMode && !added && viewerId === id) closeViewer();
  }
</script>

<svelte:head>
  <title>{album.title} · JohorStudio</title>
</svelte:head>

<div class="public-theme album">
  <header class="top" class:has-back={Boolean(back)}>
    <div class="top-inner">
      <div class="left">
        {#if favMode}
          <button type="button" class="back" aria-label="Kembali ke galeri" onclick={closeFavourites}>
            <Icon name="back" size={22} strokeWidth={2} />
          </button>
          <h1 class="fav-title">Favourite ({favIds.length})</h1>
        {:else}
          {#if back}
            <a
              class="back back-mobile"
              href={`${base}/${back.slug}`}
              onclick={(event) => {
                event.preventDefault();
                void goto(`${base}/${back.slug}`);
              }}
            >
              <Icon name="back" size={20} strokeWidth={2} />
              {back.name}
            </a>
          {/if}
          <a href="https://johorstudio.com" aria-label="JohorStudio.com" class="logo"><Logo width={120} /></a>
        {/if}
      </div>

      <div class="actions">
        {#if favMode}
          {#if album.allowDownload && favIds.length > 0}
            <IconButton label={`Download ${favIds.length} favourite (ZIP)`} name="download" size={23} hit={44} onclick={downloadFavourites} />
          {/if}
        {:else}
          <IconButton label="Kongsi album ni" name="share" size={21} hit={44} onclick={openShare} />
          <button
            type="button"
            class="icon-button fav-button"
            aria-label={`Favourite, ${favIds.length} gambar`}
            title="Favourite"
            style:width="44px"
            style:height="44px"
            onclick={openFavourites}
          >
            <Icon name="heart" size={22} />
            {#if favIds.length > 0}<span class="badge">{formatCount(favIds.length)}</span>{/if}
          </button>
          {#if album.allowDownload}
            <IconButton label="Download semua (ZIP)" name="download" size={23} hit={44} onclick={downloadAll} />
          {/if}
        {/if}
        <IconButton label="Lagi" name="more" size={21} hit={44} active={menuOpen} onclick={() => (menuOpen = !menuOpen)} />
      </div>
      <MoreMenu open={menuOpen} onclose={() => (menuOpen = false)} items={menu} />
    </div>
  </header>

  <main class="main">
    {#if favMode}
      <p class="fav-note">Pilihan disimpan dalam browser ni sahaja. Buka link di phone lain, senarai akan kosong.</p>
      {#if favIds.length === 0}
        <p class="empty">Belum ada favourite. Tekan hati pada gambar untuk simpan.</p>
      {:else}
        <JustifiedGrid
          assets={favAssets}
          targetRowHeight={200}
          gap={4}
          theme="dark"
          {favourites}
          onopen={openViewer}
          ariaLabel="Favourite"
        />
      {/if}
    {:else}
      <div class="titles">
        {#if back}
          <a
            class="back-desktop"
            href={`${base}/${back.slug}`}
            onclick={(event) => {
              event.preventDefault();
              void goto(`${base}/${back.slug}`);
            }}
          >
            <Icon name="back" size={18} strokeWidth={2} />
            {back.name}
          </a>
        {/if}
        <h1>{album.title}</h1>
        <span>{formatCount(album.assetCount)} gambar{#if album.takenAt} · {formatShortDate(album.takenAt)}{/if}</span>
      </div>

      {#if cameras.length > 0}
        <div role="tablist" aria-label="Kamera" class="tabs">
          <button
            type="button"
            role="tab"
            aria-selected={activeCam === null}
            class:on={activeCam === null}
            onclick={() => setCam(null)}
          >
            Semua<span class="tab-count"> · {formatCount(album.assetCount)}</span>
          </button>
          {#each cameras as camera (camera.camera)}
            <button
              type="button"
              role="tab"
              aria-selected={activeCam === camera.camera}
              class:on={activeCam === camera.camera}
              onclick={() => setCam(camera.camera)}
            >
              {camera.camera}<span class="tab-count"> · {formatCount(camera.count)}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#key `${album.slug}:${activeCam ?? 'all'}`}
        <BucketVirtualList
          buckets={data.buckets}
          albumSlug={album.slug}
          cam={activeCam}
          theme="dark"
          {favourites}
          onopen={openViewer}
          onloaded={onBucketLoaded}
        />
      {/key}
    {/if}
  </main>

  <footer>Gambar oleh <a href="https://johorstudio.com">JohorStudio.com</a></footer>

  {#if viewerId}
    <Viewer
      items={viewerItems}
      id={viewerId}
      album={album}
      allowDownload={album.allowDownload}
      {favourites}
      total={viewerTotal}
      onclose={closeViewer}
      onchange={changeViewer}
      ontoggle={toggleFavourite}
    />
  {/if}

  {#if shareOpen}
    <ShareSheet album={album} onclose={closeShare} />
  {/if}

  {#if toast}<span class="toast" role="status">{toast}</span>{/if}
</div>

<style>
  .album {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .top {
    background: var(--bar);
    position: relative;
  }

  .top-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--teal);
    font-size: 15px;
    font-weight: 600;
  }

  .back-mobile {
    display: none;
  }

  .fav-title {
    font-size: 19px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    color: #d7dddf;
  }

  .icon-button {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: #d7dddf;
    position: relative;
  }

  .icon-button:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .badge {
    position: absolute;
    top: 4px;
    right: 2px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 9px;
    background: var(--fav);
    color: var(--public-bg);
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .main {
    flex: 1;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 28px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .back-desktop {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    font-size: 15px;
    font-weight: 600;
    color: var(--teal);
  }

  .titles h1 {
    font-size: 40px;
    font-weight: 700;
    font-stretch: 78%;
    line-height: 1;
    color: #fff;
  }

  .titles > span {
    font-size: 15px;
    color: var(--muted);
  }

  .tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-dark);
    padding-bottom: 12px;
  }

  .tabs button {
    height: 40px;
    padding: 0 16px;
    border: 1px solid var(--line-hard);
    border-radius: 20px;
    background: transparent;
    color: #d7dddf;
    font-size: 14px;
  }

  .tabs button.on {
    border-color: transparent;
    background: var(--text);
    color: var(--public-bg);
    font-weight: 600;
  }

  .fav-note {
    margin: 14px 0 0;
    padding: 12px 14px;
    background: #1d3532;
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.4;
    color: #cdeee9;
  }

  .empty {
    color: var(--muted);
    font-size: 15px;
    padding: 32px 0;
  }

  footer {
    border-top: 1px solid var(--line-dark);
    padding: 20px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 60;
    padding: 10px 16px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  }

  @media (max-width: 720px) {
    .top-inner {
      padding: 8px 6px 8px 8px;
      gap: 8px;
    }

    .has-back .logo {
      display: none;
    }

    .back-mobile {
      display: inline-flex;
    }

    .main {
      padding: 16px 14px 40px;
      gap: 18px;
    }

    .titles h1 {
      font-size: 30px;
      font-stretch: 78%;
    }

    .back-desktop {
      display: none;
    }

    .tabs {
      padding: 0 0 12px;
    }

    .tabs button {
      height: 40px;
      padding: 0 14px;
    }

    .tab-count {
      display: none;
    }

    footer {
      display: none;
    }

    .fav-title {
      font-size: 18px;
    }
  }
</style>
