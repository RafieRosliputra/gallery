<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { SLUG_REGEX, type ClientSummary } from '@gallery/shared';
  import type { ClientAlbum, PickerFolder } from '$lib/api/models';
  import { api, ApiError, isNotFound } from '$lib/api/client';
  import { copyText } from '$lib/clipboard';
  import { formatCount } from '$lib/format';
  import AlbumTree from '$lib/components/AlbumTree.svelte';

  // One client: its name and portal link, and its albums. Tick a folder to turn
  // it into an album; inside an album, switch subfolders Visible / Hidden.
  let client = $state<ClientSummary | null>(null);
  let albums = $state<ClientAlbum[]>([]);
  let name = $state('');
  let slug = $state('');
  let loading = $state(true);
  let error = $state('');
  let note = $state('');
  let savingClient = $state(false);
  let working = $state(false);

  const id = $derived(page.params.id ?? '');
  const totalPhotos = $derived(albums.reduce((sum, album) => sum + album.count, 0));
  const dirty = $derived(Boolean(client) && (name.trim() !== client?.name || slug.trim() !== client?.slug));

  $effect(() => {
    const clientId = id;
    if (clientId) void load(clientId);
  });

  async function load(clientId: string) {
    loading = true;
    error = '';
    try {
      const response = await api.getClientAlbums(clientId);
      client = response.client;
      albums = response.albums;
      name = response.client.name;
      slug = response.client.slug;
    } catch (cause) {
      error = isNotFound(cause) ? 'Client not found.' : 'Could not load this client.';
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    try {
      albums = (await api.getClientAlbums(id)).albums;
    } catch {
      // keep what we have
    }
  }

  function flash(message: string) {
    note = message;
    window.setTimeout(() => (note = ''), 3000);
  }

  async function saveClient() {
    if (!client || savingClient) return;
    error = '';
    if (!name.trim()) return void (error = 'Client name cannot be empty.');
    if (!SLUG_REGEX.test(slug.trim())) return void (error = 'Link must be 3–60 characters: a-z, 0-9 and dashes.');
    savingClient = true;
    try {
      client = (await api.updateClient(client.id, { name: name.trim(), slug: slug.trim() })).client;
      flash('Client saved.');
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Save failed.';
    } finally {
      savingClient = false;
    }
  }

  async function tick(folder: PickerFolder) {
    if (!client || working) return;
    working = true;
    try {
      const album = await api.createFolderAlbum(client.id, folder.id);
      albums = [album, ...albums];
      flash(`Album "${album.title}" created — link /s/${album.slug}`);
      await refresh();
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Could not create the album.';
    } finally {
      working = false;
    }
  }

  async function untick(album: ClientAlbum) {
    if (working) return;
    const ok = window.confirm(
      `Remove album "${album.title}"?\n\nThe link /s/${album.slug} will stop working. Photos in the folder are NOT deleted.`
    );
    if (!ok) return;
    working = true;
    try {
      await api.deleteAlbum(album.id);
      albums = albums.filter((candidate) => candidate.id !== album.id);
      flash(`Album "${album.title}" removed.`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Could not remove the album.';
    } finally {
      working = false;
    }
  }

  async function saveRules(album: ClientAlbum) {
    try {
      await api.saveAlbumRules(album.id, album.rules);
      await refresh();
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Could not save hidden folders.';
      await refresh();
    }
  }

  async function toggleDownload(album: ClientAlbum) {
    const next = !album.allowDownload;
    albums = albums.map((candidate) => (candidate.id === album.id ? { ...candidate, allowDownload: next } : candidate));
    try {
      await api.updateAlbumSettings(album.id, { allowDownload: next });
    } catch {
      await refresh();
    }
  }

  async function copy(label: string, path: string) {
    const ok = await copyText(`${window.location.origin}${path}`);
    flash(ok ? `${label} copied.` : 'Copy failed.');
  }

  const hiddenCount = (album: ClientAlbum) => album.rules.filter((rule) => !rule.included).length;
</script>

<svelte:head>
  <title>{client?.name ?? 'Client'} · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <div class="titles">
    <a href={`${base}/admin/clients`}>← Clients</a>
    <h1>{client?.name ?? 'Client'}</h1>
    {#if client}
      <span>{formatCount(albums.length)} {albums.length === 1 ? 'album' : 'albums'} · {formatCount(totalPhotos)} photos</span>
    {/if}
  </div>
  {#if client}
    <div class="actions">
      <button type="button" class="ghost" onclick={() => copy('Portal link', `${base}/${client?.slug}`)}>Copy portal link</button>
      <a class="ghost" href={`${base}/${client.slug}`}>Open portal</a>
    </div>
  {/if}
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if note}<p class="note" role="status">{note}</p>{/if}

{#if loading}
  <p class="muted" aria-busy="true">Loading…</p>
{:else if client}
  <div class="body">
    <section class="panel tree-panel">
      <h2>Folders</h2>
      <p class="hint">
        Tick a folder = it becomes an album for this client. Inside an album, set subfolders to <strong>Hidden</strong> to keep
        them off the public page.
      </p>
      <AlbumTree bind:albums mode="client" ontick={tick} onuntick={untick} onchange={saveRules} />
    </section>

    <aside class="aside">
      <section class="panel">
        <h2>Client</h2>
        <label>Name<input type="text" bind:value={name} placeholder="Sekolah Rendah Islam Ibnu Nafis" /></label>
        <label
          >Portal link
          <span class="slug"><span>johorstudio.com/s/</span><input type="text" bind:value={slug} /></span>
        </label>
        <button type="button" class="dark" disabled={!dirty || savingClient} onclick={saveClient}>
          {savingClient ? 'Saving…' : 'Save client'}
        </button>
      </section>

      <section class="panel">
        <h2>Albums ({albums.length})</h2>
        {#each albums as album (album.id)}
          <div class="album">
            <div class="album-head">
              <strong>{album.title}</strong>
              <span class="muted">{`${formatCount(album.count)} photos${hiddenCount(album) > 0 ? ` · ${hiddenCount(album)} hidden` : ''}`}</span>
            </div>
            <span class="link">/s/{album.slug}</span>
            <div class="album-actions">
              <button type="button" class="ghost small" onclick={() => copy(`Link for ${album.title}`, `${base}/${album.slug}`)}>Copy link</button>
              <a class="ghost small" href={`${base}/admin/albums/${album.id}`}>Edit</a>
              <label class="dl"
                ><input type="checkbox" checked={album.allowDownload} onchange={() => toggleDownload(album)} /> Download</label
              >
              <button type="button" class="ghost small danger" onclick={() => untick(album)}>Delete</button>
            </div>
          </div>
        {:else}
          <p class="muted">No albums yet. Tick a folder on the left.</p>
        {/each}
      </section>
    </aside>
  </div>
{/if}

{#if working}<p class="working" aria-busy="true">Working…</p>{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
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
  .titles span {
    font-size: 14px;
    color: var(--steel);
  }
  h1 {
    font-size: 30px;
    font-weight: 700;
    font-stretch: 85%;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .body {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-start;
  }
  .tree-panel {
    flex: 999 1 460px;
    min-width: 0;
  }
  .aside {
    flex: 1 1 320px;
    max-width: 440px;
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
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--steel);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
  }
  input[type='text'] {
    height: 44px;
    border: 1px solid #c4ccce;
    border-radius: 6px;
    padding: 0 12px;
    font-size: 15px;
    font-weight: 400;
  }
  .slug {
    display: flex;
    align-items: center;
    border: 1px solid #c4ccce;
    border-radius: 6px;
    height: 44px;
    overflow: hidden;
    font-weight: 400;
  }
  .slug span {
    padding: 0 10px;
    background: var(--mist);
    height: 100%;
    display: flex;
    align-items: center;
    font-size: 13px;
    color: var(--steel);
  }
  .slug input {
    border: 0;
    flex: 1;
    min-width: 0;
    height: 100%;
    outline: 0;
  }
  .album {
    border-top: 1px solid var(--mist);
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .album-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .link {
    font-size: 13px;
    color: var(--teal-ink);
  }
  .album-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .dl input {
    accent-color: var(--teal-ink);
  }
  .dl {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-weight: 400;
    font-size: 13px;
  }
  .ghost,
  .dark {
    height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ghost {
    border: 1px solid #c4ccce;
    background: #fff;
    color: var(--graphite);
  }
  .ghost.small {
    height: 32px;
    padding: 0 10px;
    font-size: 13px;
  }
  .danger {
    color: #8a2a24;
    border-color: #e3b4af;
  }
  .dark {
    border: 0;
    background: var(--teal-ink);
    color: #fff;
    font-weight: 600;
  }
  .dark:disabled {
    opacity: 0.5;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    background: #f8e3e1;
    color: #8a2a24;
    border-radius: 6px;
    font-size: 14px;
  }
  .note {
    margin: 0;
    padding: 10px 12px;
    background: #e3f2ef;
    color: var(--teal-ink);
    border-radius: 6px;
    font-size: 14px;
  }
  .muted {
    color: var(--steel);
    font-size: 13px;
  }
  .working {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 14px;
    border-radius: 16px;
    background: var(--graphite);
    color: #fff;
    font-size: 13px;
  }
  @media (max-width: 700px) {
    .aside {
      max-width: none;
      flex-basis: 100%;
    }
  }
</style>
