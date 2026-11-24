<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { AdminClient } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { copyText } from '$lib/clipboard';
  import { formatCount, formatShortDate } from '$lib/format';

  let clients = $state<AdminClient[]>([]);
  let error = $state('');
  let copied = $state('');
  let adding = $state(false);
  let newName = $state('');
  let newSlug = $state('');
  let createError = $state('');
  let creating = $state(false);
  let loaded = $state(false);

  onMount(async () => {
    try {
      clients = await api.getAdminClients();
    } catch (cause) {
      console.error('clients failed', cause);
      error = 'Could not load clients.';
    } finally {
      loaded = true;
    }
  });

  function absolute(path: string): string {
    return `${window.location.origin}${path}`;
  }

  async function copy(label: string, path: string) {
    const ok = await copyText(absolute(path));
    copied = ok ? label : `Could not copy ${label}`;
    window.setTimeout(() => (copied = ''), 2500);
  }

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function onName() {
    if (!newSlug) newSlug = slugify(newName);
  }

  async function removeClient(client: AdminClient) {
    const albums = client.albums.length;
    const ok = window.confirm(
      `Delete client "${client.name}"?\n\n` +
        (albums > 0 ? `Their ${albums} album(s) will be deleted too and all their /s/... links will stop working.\n` : '') +
        'Photos in the folders are NOT deleted.'
    );
    if (!ok) return;
    try {
      await api.deleteClient(client.id);
      clients = clients.filter((candidate) => candidate.id !== client.id);
      copied = `Client ${client.name} deleted.`;
    } catch (cause) {
      copied = cause instanceof Error ? `Delete failed: ${cause.message}` : 'Delete failed.';
    }
    window.setTimeout(() => (copied = ''), 3000);
  }

  async function removeAlbum(client: AdminClient, album: AdminClient['albums'][number]) {
    const ok = window.confirm(
      `Delete album "${album.title}"?\n\nThe link /s/${album.slug} will stop working. Photos in the folder are NOT deleted.`
    );
    if (!ok) return;
    try {
      await api.deleteAlbum(album.id);
      clients = clients.map((candidate) =>
        candidate.id === client.id
          ? {
              ...candidate,
              albumCount: candidate.albumCount - 1,
              assetCount: candidate.assetCount - album.assetCount,
              albums: candidate.albums.filter((item) => item.id !== album.id)
            }
          : candidate
      );
      copied = `Album ${album.title} deleted.`;
    } catch (cause) {
      copied = cause instanceof Error ? `Delete failed: ${cause.message}` : 'Delete failed.';
    }
    window.setTimeout(() => (copied = ''), 3000);
  }

  async function createClient(event: SubmitEvent) {
    event.preventDefault();
    if (creating) return;
    createError = '';
    if (!newName.trim() || newSlug.length < 3) {
      createError = 'Name and link (3–60 characters) are required.';
      return;
    }
    creating = true;
    try {
      const response = await api.createClient({ name: newName.trim(), slug: newSlug.trim() });
      clients = [...clients, response.client];
      adding = false;
      newName = '';
      newSlug = '';
      copied = 'Client created.';
      window.setTimeout(() => (copied = ''), 2500);
    } catch (cause) {
      createError = cause instanceof Error ? cause.message : 'Could not create the client.';
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head>
  <title>Clients · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <div class="titles">
    <h1>Clients</h1>
    <span>1 client = 1 portal link with every event they booked. Open “Manage albums” and tick folders — each ticked folder is an album with its own share link.</span>
  </div>
  <button type="button" class="new" aria-expanded={adding} onclick={() => (adding = !adding)}>+ New client</button>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if adding}
  <form class="create" onsubmit={createClient}>
    <label>Client name<input type="text" bind:value={newName} oninput={onName} placeholder="Sekolah Rendah Islam Ibnu Nafis" /></label>
    <label>Portal link
      <span class="slug"><span>johorstudio.com/s/</span><input type="text" bind:value={newSlug} placeholder="sriin" /></span>
    </label>
    {#if createError}<span class="create-error" role="alert">{createError}</span>{/if}
    <div class="create-actions">
      <button type="button" class="ghost" onclick={() => (adding = false)}>Cancel</button>
      <button type="submit" class="dark" disabled={creating}>{creating ? 'Saving…' : 'Save client'}</button>
    </div>
  </form>
{/if}
{#if copied}<p class="toast" role="status">{copied}</p>{/if}

{#each clients as client (client.id)}
  <section class="client">
    <div class="client-head">
      <div class="who">
        <h2><a class="client-link" href={`${base}/admin/clients/${client.id}`}>{client.name}</a></h2>
        <span class="portal">
          Portal: <strong>johorstudio.com/s/<em>{client.slug}</em></strong> · {client.albumCount} {client.albumCount === 1 ? 'album' : 'albums'} · {formatCount(client.assetCount)} photos
        </span>
      </div>
      <div class="client-actions">
        <button type="button" class="ghost" onclick={() => copy(`Portal link for ${client.name}`, `/s/${client.slug}`)}>Copy portal link</button>
        <a class="ghost" href={`${base}/${client.slug}`}>Open</a>
        <a class="dark" href={`${base}/admin/clients/${client.id}`}>Manage albums</a>
        <button type="button" class="ghost danger" onclick={() => removeClient(client)}>Delete client</button>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Album (event)</th>
            <th>Album link (to share)</th>
            <th>Photos</th>
            <th>Cameras</th>
            <th>Download</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each client.albums as album (album.id)}
            <tr>
              <td class="album-title">{album.title}{#if album.takenAt}<span class="event-date">{formatShortDate(album.takenAt)}</span>{/if}</td>
              <td class="nowrap">/s/<em>{album.slug}</em></td>
              <td>{formatCount(album.assetCount)}</td>
              <td class="muted">{album.cameras.length > 1 ? album.cameras.join(', ') : album.cameras.length === 1 ? '1 camera' : '—'}</td>
              <td>{album.allowDownload ? 'On' : 'Off'}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="ghost small" onclick={() => copy(`Link ${album.title}`, `/s/${album.slug}`)}>Copy</button>
                  <a class="ghost small" href={`${base}/admin/albums/${album.id}`}>Edit</a>
                  <button type="button" class="ghost small danger" onclick={() => removeAlbum(client, album)}>Delete</button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{:else}
  {#if !loaded}<p class="loading" aria-busy="true">Loading clients…</p>
  {:else if !error}<p class="loading">No clients yet. Press “+ New client” to start.</p>{/if}
{/each}

<style>
  .danger {
    color: #8a2a24 !important;
    border-color: #e3b4af !important;
  }

  .event-date {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: var(--steel);
  }

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

  h1 {
    font-size: 30px;
    font-weight: 700;
    font-stretch: 85%;
  }

  .titles span {
    font-size: 14px;
    color: var(--steel);
  }

  .new {
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 6px;
    background: var(--teal-ink);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }

  .create {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
    padding: 16px;
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
  }

  .create label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    flex: 1 1 220px;
  }

  .create input {
    height: 44px;
    border: 1px solid #c4ccce;
    border-radius: 6px;
    padding: 0 12px;
    font-size: 15px;
    font-weight: 400;
    background: #fff;
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

  .slug > span {
    padding: 0 8px;
    background: var(--mist);
    color: var(--steel);
    font-size: 13px;
    height: 100%;
    display: flex;
    align-items: center;
    flex: none;
  }

  .slug input {
    border: 0;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
  }

  .create-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .create-error {
    flex: 1 1 100%;
    color: #8a2a24;
    font-size: 13px;
  }

  .error,
  .toast {
    margin: 0;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 14px;
  }

  .error {
    background: #f8e3e1;
    color: #8a2a24;
  }

  .toast {
    background: var(--teal-soft);
    color: var(--teal-ink);
  }

  .client {
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    overflow: hidden;
  }

  .client-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px;
    background: #fafbfb;
    border-bottom: 1px solid var(--mist);
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .who h2 {
    font-size: 19px;
    font-weight: 700;
  }

  .portal {
    font-size: 14px;
    color: var(--steel);
  }

  .portal strong {
    color: var(--graphite);
  }

  .portal em,
  td em {
    font-style: normal;
    color: var(--teal-ink);
    font-weight: 600;
  }

  .client-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ghost,
  .dark {
    height: 38px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
  }

  .ghost {
    border: 1px solid #c4ccce;
    background: #fff;
    color: var(--graphite);
  }

  .dark {
    background: var(--graphite);
    color: #fff;
  }

  .small {
    height: 36px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
    font-size: 14px;
  }

  th {
    text-align: left;
    color: var(--steel);
    font-size: 13px;
    font-weight: 600;
    padding: 10px 18px;
  }

  td {
    padding: 12px 18px;
    border-top: 1px solid #eef1f1;
  }

  .album-title {
    font-weight: 600;
  }

  .nowrap {
    white-space: nowrap;
  }

  .muted {
    color: var(--steel);
  }

  .row-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .loading {
    color: var(--steel);
    font-size: 14px;
  }
</style>
