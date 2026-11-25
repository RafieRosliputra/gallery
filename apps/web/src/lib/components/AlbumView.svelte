<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { AlbumFolderView, AlbumResponse, Asset, BucketRef } from '$lib/api/models';
  import { api, downloadBlob } from '$lib/api/client';
  import { copyText } from '$lib/clipboard';
  import { formatCount, formatShortDate } from '$lib/format';
  import { getFavourites } from '$lib/stores/favourites';
  import { openedFromClient } from '$lib/routing/back';
  import BucketVirtualList from '$lib/components/BucketVirtualList.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import JustifiedGrid from '$lib/components/JustifiedGrid.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import Photo from '$lib/components/Photo.svelte';
  import RichText from '$lib/components/RichText.svelte';
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import ShareSheet from '$lib/components/ShareSheet.svelte';
  import Viewer from '$lib/components/Viewer.svelte';
  import type { MenuItem } from '$lib/components/menu';

  let { data }: { data: AlbumResponse } = $props();

  const album = $derived(data.album);
  const favourites = $derived(getFavourites(album.slug));
  const favIds = $derived($favourites);

  const folderParam = $derived(page.url.searchParams.get('f'));
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
  let view = $state<AlbumFolderView | null>(null);
  let viewKey = $state('');
  let viewError = $state('');

  // Folder navigation: `?f=<folderId>`; no param = album top.
  $effect(() => {
    const slug = album.slug;
    const folder = folderParam;
    const key = `${slug}:${folder ?? ''}`;
    let cancelled = false;
    viewError = '';
    api
      .getAlbumFolders(slug, folder)
      .then((result) => {
        if (cancelled) return;
        view = result;
        viewKey = key;
      })
      .catch((cause) => {
        if (cancelled) return;
        console.error('album folder failed', cause);
        viewError = 'Could not load this folder.';
      });
    return () => {
      cancelled = true;
    };
  });

  const folderBuckets = $derived<BucketRef[]>(
    view && view.folderId && view.assetCount > 0
      ? [{ key: `f:${view.folderId}`, count: view.assetCount, label: '' }]
      : []
  );

  $effect(() => {
    if (!viewerId) viewerPushed = false;
  });

  $effect(() => {
    if (!favMode) favPushed = false;
  });

  const loaded = $derived.by(() => {
    const map = new Map<string, Asset>();
    for (const bucket of folderBuckets) {
      for (const item of itemsByBucket[`all:${bucket.key}`] ?? []) {
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

  const viewerTotal = $derived(
    favMode ? Math.max(favIds.length, viewerItems.length) : Math.max(view?.assetCount ?? 0, viewerItems.length)
  );

  $effect(() => {
    const id = viewerId;
    if (!id) return;
    if (loaded.has(id) || directAssets[id]) return;
    let cancelled = false;
    api
      .getAsset(id, album.slug)
      .then((response) => {
        if (!cancelled) directAssets = { ...directAssets, [id]: response.asset };
      })
      .catch(() => {
        if (!cancelled) toast = 'Photo not found.';
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
          return (await api.getAsset(id, album.slug)).asset;
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
        items.push({ label: 'Clear list', icon: 'trash', onclick: () => favourites.clear() });
      }
    } else if (album.allowDownload && favIds.length > 0) {
      items.push({
        label: `Download favourite (ZIP)`,
        icon: 'download',
        onclick: () => void downloadFavourites()
      });
    }
    if (data.viewerIsAdmin) {
      items.push({ label: 'Generate thumbnails (admin)', icon: 'refresh', onclick: () => void forceThumbs() });
    }
    items.push({ label: 'Go to JohorStudio.com', icon: 'globe', href: 'https://johorstudio.com' });
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

  function openFolder(id: string | null) {
    void goto(urlWith({ f: id }), { keepFocus: true });
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
    toast = 'Preparing ZIP…';
    try {
      const blob = await api.zip({ albumSlug: album.slug });
      downloadBlob(blob, `${album.slug}.zip`);
      toast = 'Download started.';
    } catch {
      toast = 'Could not prepare the ZIP.';
    } finally {
      zipBusy = false;
      window.setTimeout(() => (toast = ''), 3000);
    }
  }

  async function downloadFavourites() {
    if (!album.allowDownload || zipBusy || favIds.length === 0) return;
    zipBusy = true;
    toast = 'Preparing favourites ZIP…';
    try {
      const blob = await api.zip({ albumSlug: album.slug, ids: favIds });
      downloadBlob(blob, `favourite-${album.slug}.zip`);
      toast = 'Download started.';
    } catch {
      toast = 'Could not prepare the ZIP.';
    } finally {
      zipBusy = false;
      window.setTimeout(() => (toast = ''), 3000);
    }
  }

  async function copyFavNames() {
    const names = favAssets.map((asset) => asset.name).filter((name): name is string => Boolean(name));
    if (names.length === 0) {
      toast = 'File names are still loading.';
    } else {
      const ok = await copyText(names.join('\n'));
      toast = ok ? `Copied ${names.length} file ${names.length === 1 ? 'name' : 'names'}` : 'Could not copy';
    }
    window.setTimeout(() => (toast = ''), 3000);
  }

  async function forceThumbs() {
    try {
      const result = await api.forceAlbumThumbs(album.id);
      toast =
        result.queued > 0
          ? `${formatCount(result.queued)} thumbnails queued first. Refresh in a moment.`
          : 'All thumbnails are ready.';
    } catch {
      toast = 'Could not queue thumbnails.';
    }
    window.setTimeout(() => (toast = ''), 4000);
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
          <button type="button" class="back" aria-label="Back to gallery" onclick={closeFavourites}>
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
          {#if favIds.length > 0}
            <IconButton label="Copy file names" name="copy" size={21} hit={44} onclick={copyFavNames} />
          {/if}
          {#if album.allowDownload && favIds.length > 0}
            <IconButton label={`Download ${favIds.length} favourite (ZIP)`} name="download" size={23} hit={44} onclick={downloadFavourites} />
          {/if}
        {:else}
          <IconButton label="Share this album" name="share" size={21} hit={44} onclick={openShare} />
          <button
            type="button"
            class="icon-button fav-button"
            aria-label={`Favourites, ${favIds.length} ${favIds.length === 1 ? 'photo' : 'photos'}`}
            title="Favourite"
            style:width="44px"
            style:height="44px"
            onclick={openFavourites}
          >
            <Icon name="heart" size={22} />
            {#if favIds.length > 0}<span class="badge">{formatCount(favIds.length)}</span>{/if}
          </button>
          {#if album.allowDownload}
            <IconButton label="Download all (ZIP)" name="download" size={23} hit={44} onclick={downloadAll} />
          {/if}
        {/if}
        <IconButton label="More" name="more" size={21} hit={44} active={menuOpen} onclick={() => (menuOpen = !menuOpen)} />
      </div>
      <MoreMenu open={menuOpen} onclose={() => (menuOpen = false)} items={menu} />
    </div>
  </header>

  <main class="main">
    {#if favMode}
      <p class="fav-note">Favourites are saved in this browser only. On another phone the list starts empty.</p>
      {#if favIds.length === 0}
        <p class="empty">No favourites yet. Tap the heart on a photo to save it.</p>
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
        <span>{`${formatCount(album.assetCount)} photos${album.takenAt ? ` · ${formatShortDate(album.takenAt)}` : ''}`}</span>
        <RichText text={album.description || data.client.description || ''} />
      </div>

      {#if view && view.trail.length > 0}
        <nav class="crumbs" aria-label="Folder">
          <a
            href={urlWith({ f: null })}
            onclick={(event) => {
              event.preventDefault();
              openFolder(null);
            }}>All folders</a
          >
          {#each view.trail as step, index (step.id)}
            <span aria-hidden="true">›</span>
            {#if index === view.trail.length - 1}
              <strong aria-current="page">{step.name}</strong>
            {:else}
              <a
                href={urlWith({ f: step.id })}
                onclick={(event) => {
                  event.preventDefault();
                  openFolder(step.id);
                }}>{step.name}</a
              >
            {/if}
          {/each}
        </nav>
      {/if}

      {#if viewError}
        <p class="empty">{viewError}</p>
      {:else if !view}
        <p class="empty" aria-busy="true">Loading…</p>
      {:else}
        {#if view.folders.length > 0}
          <div class="folders">
            {#each view.folders as card (card.id)}
              <a
                class="folder"
                href={urlWith({ f: card.id })}
                onclick={(event) => {
                  event.preventDefault();
                  openFolder(card.id);
                }}
              >
                <span class="cover">
                  {#if card.cover}<Photo asset={card.cover} />{/if}
                </span>
                <span class="folder-name">{card.name}</span>
                <span class="folder-count">{formatCount(card.count)} photos</span>
              </a>
            {/each}
          </div>
        {/if}

        {#if folderBuckets.length > 0}
          {#key viewKey}
            <BucketVirtualList
              buckets={folderBuckets}
              albumSlug={album.slug}
              theme="dark"
              {favourites}
              onopen={openViewer}
              onloaded={onBucketLoaded}
            />
          {/key}
        {:else if view.folders.length === 0}
          <p class="empty">No photos in this folder.</p>
        {/if}
      {/if}
    {/if}
  </main>

  <footer>Photos by <a href="https://johorstudio.com">JohorStudio.com</a></footer>

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

  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    color: var(--muted);
  }

  .crumbs a {
    color: var(--teal);
    font-weight: 600;
  }

  .crumbs strong {
    color: #fff;
    font-weight: 600;
  }

  .folders {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 18px 14px;
  }

  .folder {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: inherit;
    text-decoration: none;
  }

  .cover {
    position: relative;
    display: block;
    aspect-ratio: 4 / 3;
    border-radius: 10px;
    overflow: hidden;
    background: #262d31;
    margin-bottom: 6px;
  }

  .folder:hover .cover {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .folder-name {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-count {
    font-size: 13px;
    color: var(--muted);
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

    .folders {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 10px;
    }

    footer {
      display: none;
    }

    .fav-title {
      font-size: 18px;
    }
  }
</style>
