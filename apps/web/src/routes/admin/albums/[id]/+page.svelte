<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { AdminAlbumDetail, AlbumSort, ClientAlbum, ThumbProgress } from '$lib/api/models';
  import type { ClientSummary } from '@gallery/shared';
  import { SLUG_REGEX } from '@gallery/shared';
  import { api, ApiError, isNotFound } from '$lib/api/client';
  import { formatCount } from '$lib/format';
  import Photo from '$lib/components/Photo.svelte';
  import AlbumTree from '$lib/components/AlbumTree.svelte';

  // One album = one folder. Here: its name, link, download switch, which
  // subfolders are hidden from the public, thumbnails, delete.
  let detail = $state<AdminAlbumDetail | null>(null);
  let clients = $state<ClientSummary[]>([]);
  let tree = $state<ClientAlbum[]>([]);
  let thumbs = $state<ThumbProgress | null>(null);
  let thumbBusy = $state(false);
  let thumbNote = $state('');
  let deleting = $state(false);
  let stats = $state<{ assetCount: number; folderCount: number } | null>(null);
  let clientId = $state('');
  let title = $state('');
  let slug = $state('');
  let allowDownload = $state(true);
  let description = $state('');
  let sort = $state<AlbumSort>('name');
  let slugState = $state<'idle' | 'checking' | 'free' | 'taken'>('idle');
  let saving = $state(false);
  let error = $state('');
  let loading = $state(true);

  const id = $derived(page.params.id ?? '');
  const rules = $derived(tree[0]?.rules ?? []);
  const roots = $derived(
    rules
      .filter((rule) => rule.included)
      .filter((rule) => !rules.some((other) => other.included && other !== rule && rule.path.startsWith(`${other.path}/`)))
  );
  const rootFolderId = $derived(roots[0]?.folderId);
  const clientOf = $derived(clients.find((client) => client.id === clientId));

  $effect(() => {
    const albumId = id;
    if (albumId === 'new') {
      const client = page.url.searchParams.get('client');
      void goto(client ? `${base}/admin/clients/${client}` : `${base}/admin/clients`, { replaceState: true });
      return;
    }
    if (albumId) void load(albumId);
  });

  async function load(albumId: string) {
    loading = true;
    error = '';
    try {
      const response = await api.getAdminAlbum(albumId);
      detail = response;
      clients = response.clients;
      clientId = response.album.clientId;
      title = response.album.title;
      slug = response.album.slug;
      allowDownload = response.album.allowDownload;
      description = response.album.description ?? '';
      sort = response.album.sort ?? 'name';
      tree = [
        {
          id: response.album.id,
          title: response.album.title,
          slug: response.album.slug,
          allowDownload: response.album.allowDownload,
          description: response.album.description ?? '',
          count: response.album.assetCount,
          rules: response.rules
        }
      ];
      slugState = 'free';
    } catch (cause) {
      console.error('album load failed', cause);
      error = isNotFound(cause) ? 'Album not found.' : 'Could not load this album.';
    } finally {
      loading = false;
    }
  }

  // Thumbnail progress; polls while anything is pending.
  $effect(() => {
    const albumId = id;
    if (!albumId || albumId === 'new') return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        thumbs = await api.getAlbumThumbs(albumId);
      } catch {
        thumbs = null;
      }
      if (!stop && thumbs && thumbs.pending > 0) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  });

  // Live total for the current (unsaved) visibility.
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const snapshot = rules.map(({ folderId, path, included }) => ({ folderId, path, included }));
    clearTimeout(statsTimer);
    if (snapshot.length === 0) return;
    statsTimer = setTimeout(() => {
      api
        .previewScope(snapshot)
        .then((result) => (stats = result))
        .catch(() => (stats = null));
    }, 250);
  });

  async function forceThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    thumbNote = '';
    try {
      const result = await api.forceAlbumThumbs(id);
      thumbNote =
        result.queued > 0 ? `${formatCount(result.queued)} photos moved to the front of the queue.` : 'All thumbnails are ready.';
      thumbs = await api.getAlbumThumbs(id);
      if (thumbs.pending > 0) {
        const again = async () => {
          thumbs = await api.getAlbumThumbs(id).catch(() => thumbs);
          if (thumbs && thumbs.pending > 0 && page.params.id === id) setTimeout(again, 5000);
        };
        setTimeout(again, 5000);
      }
    } catch (cause) {
      thumbNote = cause instanceof ApiError ? cause.message : 'Could not queue thumbnails. Try again.';
    } finally {
      thumbBusy = false;
    }
  }

  async function removeAlbum() {
    if (deleting || !detail) return;
    const ok = window.confirm(
      `Delete album "${detail.album.title}"?\n\nThe link /s/${detail.album.slug} will stop working. Photos in the folder are NOT deleted.`
    );
    if (!ok) return;
    deleting = true;
    try {
      await api.deleteAlbum(id);
      await goto(`${base}/admin/clients/${clientId}`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Delete failed. Try again.';
    } finally {
      deleting = false;
    }
  }

  let slugTimer: ReturnType<typeof setTimeout> | undefined;

  function checkSlug() {
    clearTimeout(slugTimer);
    const candidate = slug.trim();
    if (!SLUG_REGEX.test(candidate)) {
      slugState = 'idle';
      return;
    }
    if (candidate === detail?.album.slug) {
      slugState = 'free';
      return;
    }
    slugState = 'checking';
    slugTimer = setTimeout(async () => {
      try {
        await api.resolve(candidate);
        slugState = 'taken';
      } catch (cause) {
        slugState = isNotFound(cause) ? 'free' : 'idle';
      }
    }, 300);
  }

  async function save() {
    if (saving) return;
    error = '';
    if (!clientId) return void (error = 'Choose a client first.');
    if (!title.trim()) return void (error = 'Album name cannot be empty.');
    if (!SLUG_REGEX.test(slug.trim())) return void (error = 'Link must be 3–60 characters: a-z, 0-9 and dashes.');
    if (slugState === 'taken') return void (error = 'That link is already used.');
    saving = true;
    try {
      await api.saveAlbum(id, {
        clientId,
        title: title.trim(),
        slug: slug.trim(),
        allowDownload,
        description: description.trim(),
        sort,
        rules
      });
      await goto(`${base}/admin/clients/${clientId}`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Save failed. Try again.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Edit album · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <div class="titles">
    <a href={clientOf ? `${base}/admin/clients/${clientOf.id}` : `${base}/admin/clients`}>← {clientOf?.name ?? 'Clients'}</a>
    <h1>{detail?.album.title ?? 'Album'}</h1>
  </div>
  <div class="actions">
    <button class="danger" type="button" onclick={removeAlbum} disabled={deleting || loading}>
      {deleting ? 'Deleting…' : 'Delete album'}
    </button>
    <a class="cancel" href={clientOf ? `${base}/admin/clients/${clientOf.id}` : `${base}/admin/clients`}>Cancel</a>
    <button class="save" type="button" onclick={save} disabled={saving || loading}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
</header>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if loading}
  <p class="loading" aria-busy="true">Loading album…</p>
{:else if detail}
  <div class="body">
    <section class="form">
      <label>
        Album name
        <input type="text" bind:value={title} placeholder="e.g. Annual Sports Day 2026" />
      </label>

      <label>
        Text under the album name
        <textarea
          bind:value={description}
          rows="3"
          maxlength="1000"
          placeholder="Leave empty to use the client's text. Links like johorstudio.com become clickable."
        ></textarea>
      </label>

      <fieldset>
        <legend>Folder</legend>
        <p class="hint">Everything inside this folder is in the album. Set a subfolder to <strong>Hidden</strong> to keep it off the public page.</p>
        {#if roots.length > 1}
          <p class="warn">This older album covers {roots.length} folders; only the first is shown here. Recreate it from the client page as one album per folder.</p>
        {/if}
        {#if rootFolderId}
          {#key rootFolderId}
            <AlbumTree bind:albums={tree} mode="album" {rootFolderId} />
          {/key}
        {:else}
          <p class="hint">No folder. Delete this album and tick a folder on the client page.</p>
        {/if}
      </fieldset>
    </section>

    <aside class="aside">
      <section class="panel">
        <h2>On the public page</h2>
        <div class="total">
          <span>Photos</span>
          <span>{stats ? `${formatCount(stats.assetCount)} · ${formatCount(stats.folderCount)} folders` : formatCount(detail.album.assetCount)}</span>
        </div>
        <div class="preview">
          {#each Array(4) as _, index (index)}
            {@const asset = detail.previews[index]}
            <span class="preview-tile">
              {#if asset}<Photo {asset} theme="light" />{/if}
            </span>
          {/each}
        </div>
      </section>

      <section class="panel">
        <h2>Thumbnails</h2>
        {#if thumbs}
          <div class="bar" aria-hidden="true">
            <span style:width={`${thumbs.total ? (thumbs.ready / thumbs.total) * 100 : 100}%`}></span>
          </div>
          <span class="thumb-line">
            {formatCount(thumbs.ready)} / {formatCount(thumbs.total)} ready{#if thumbs.failed > 0} · {formatCount(thumbs.failed)} failed{/if}
          </span>
        {:else}
          <span class="muted">Checking…</span>
        {/if}
        <button class="force" type="button" onclick={forceThumbs} disabled={thumbBusy || !thumbs || thumbs.pending === 0}>
          {thumbBusy ? 'Queuing…' : 'Generate thumbnails now'}
        </button>
        {#if thumbNote}<span class="muted">{thumbNote}</span>{/if}
      </section>

      <section class="panel">
        <h2>Album link</h2>
        <label>
          Link
          <span class="slug-field">
            <span class="prefix">johorstudio.com/s/</span>
            <input type="text" bind:value={slug} oninput={checkSlug} placeholder="album-link" />
          </span>
        </label>
        {#if slugState === 'free'}
          <span class="ok">✓ Available</span>
        {:else if slugState === 'taken'}
          <span class="bad">Already used. Pick another.</span>
        {:else if slugState === 'checking'}
          <span class="muted">Checking…</span>
        {/if}
        <label>
          Photo order in folders
          <select bind:value={sort}>
            <option value="name">File name (A → Z)</option>
            <option value="taken">Time taken (oldest first)</option>
            <option value="taken_desc">Time taken (newest first)</option>
          </select>
        </label>
        <label class="download-row">
          Allow downloads
          <input type="checkbox" bind:checked={allowDownload} />
        </label>
        <label>
          Client
          <select bind:value={clientId}>
            {#each clients as client (client.id)}
              <option value={client.id}>{client.name} (/s/{client.slug})</option>
            {/each}
          </select>
        </label>
      </section>
    </aside>
  </div>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .titles {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .titles a {
    font-size: 14px;
  }
  h1 {
    font-size: 30px;
    font-weight: 700;
    font-stretch: 85%;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .cancel,
  .save,
  .danger {
    height: 44px;
    padding: 0 18px;
    border-radius: 6px;
    font-size: 15px;
    display: inline-flex;
    align-items: center;
  }
  .cancel {
    border: 1px solid #c4ccce;
    color: var(--graphite);
    background: #fff;
  }
  .save {
    border: 0;
    background: var(--teal-ink);
    color: #fff;
    font-weight: 600;
  }
  .danger {
    border: 1px solid #e3b4af;
    background: #fff;
    color: #8a2a24;
  }
  .save:disabled,
  .danger:disabled,
  .force:disabled {
    opacity: 0.6;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    background: #f8e3e1;
    color: #8a2a24;
    border-radius: 6px;
    font-size: 14px;
  }
  .warn {
    margin: 0;
    padding: 8px 10px;
    background: #fff4dc;
    color: #7a5a12;
    border-radius: 6px;
    font-size: 13px;
  }
  .loading {
    color: var(--steel);
    font-size: 14px;
  }
  .body {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-start;
  }
  .form {
    flex: 999 1 420px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .form > label,
  .panel label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
  }
  textarea {
    border: 1px solid #c4ccce;
    border-radius: 6px;
    padding: 10px 14px;
    font: inherit;
    font-size: 15px;
    font-weight: 400;
    resize: vertical;
  }

  select,
  .form input[type='text'] {
    height: 46px;
    border: 1px solid #c4ccce;
    border-radius: 6px;
    padding: 0 14px;
    font-size: 16px;
    font-weight: 400;
    background: #fff;
    color: var(--graphite);
  }
  fieldset {
    margin: 0;
    border: 1px solid var(--mist);
    border-radius: 6px;
    background: #fff;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    font-size: 14px;
    font-weight: 600;
    padding: 0 6px;
  }
  .hint {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--steel);
  }
  .aside {
    flex: 1 1 320px;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .panel {
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel h2 {
    font-size: 16px;
    font-weight: 600;
  }
  .total {
    display: flex;
    justify-content: space-between;
    font-size: 15px;
    font-weight: 600;
  }
  .preview {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 3px;
  }
  .preview-tile {
    position: relative;
    height: 60px;
    background: linear-gradient(135deg, #d8cfc4, #9fb0a8);
    overflow: hidden;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--mist);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--teal-ink);
  }
  .thumb-line {
    font-size: 14px;
  }
  .force {
    height: 42px;
    border: 0;
    border-radius: 6px;
    background: var(--teal-ink);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }
  .slug-field {
    display: flex;
    align-items: center;
    border: 1px solid #c4ccce;
    border-radius: 6px;
    height: 46px;
    overflow: hidden;
    font-weight: 400;
  }
  .prefix {
    padding: 0 10px;
    background: var(--mist);
    height: 100%;
    display: flex;
    align-items: center;
    font-size: 14px;
    color: var(--steel);
    flex: none;
  }
  .slug-field input {
    border: 0 !important;
    outline: 0;
    flex: 1;
    min-width: 0;
    padding: 0 10px;
    height: 100%;
    font-size: 15px;
  }
  .ok,
  .bad,
  .muted {
    font-size: 13px;
    font-weight: 400;
  }
  .ok {
    color: var(--teal-ink);
  }
  .bad {
    color: #8a2a24;
  }
  .muted {
    color: var(--steel);
  }
  .download-row {
    flex-direction: row !important;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 15px;
    min-height: 44px;
  }
  .download-row input {
    width: 20px;
    height: 20px;
    accent-color: var(--teal-ink);
  }
  @media (max-width: 700px) {
    .aside {
      max-width: none;
      flex-basis: 100%;
    }
  }
</style>
