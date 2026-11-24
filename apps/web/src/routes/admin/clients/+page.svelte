<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { AdminClient } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { copyText } from '$lib/clipboard';
  import { formatCount } from '$lib/format';

  let clients = $state<AdminClient[]>([]);
  let error = $state('');
  let copied = $state('');
  let adding = $state(false);
  let newName = $state('');
  let newSlug = $state('');
  let createError = $state('');
  let creating = $state(false);

  onMount(async () => {
    try {
      clients = await api.getAdminClients();
    } catch (cause) {
      console.error('klien gagal', cause);
      error = 'Senarai klien tak dapat dimuatkan.';
    }
  });

  function absolute(path: string): string {
    return `${window.location.origin}${path}`;
  }

  async function copy(label: string, path: string) {
    const ok = await copyText(absolute(path));
    copied = ok ? label : `Gagal salin ${label}`;
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

  async function createClient(event: SubmitEvent) {
    event.preventDefault();
    if (creating) return;
    createError = '';
    if (!newName.trim() || newSlug.length < 3) {
      createError = 'Nama dan slug (3–60 aksara) diperlukan.';
      return;
    }
    creating = true;
    try {
      const response = await api.createClient({ name: newName.trim(), slug: newSlug.trim() });
      clients = [...clients, response.client];
      adding = false;
      newName = '';
      newSlug = '';
      copied = 'Klien baru dicipta.';
      window.setTimeout(() => (copied = ''), 2500);
    } catch (cause) {
      createError = cause instanceof Error ? cause.message : 'Klien gagal dicipta.';
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head>
  <title>Klien · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <div class="titles">
    <h1>Klien</h1>
    <span>1 klien = 1 link portal. Setiap album ada link sendiri untuk klien share kepada customer dia.</span>
  </div>
  <button type="button" class="new" aria-expanded={adding} onclick={() => (adding = !adding)}>+ Klien baru</button>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if adding}
  <form class="create" onsubmit={createClient}>
    <label>Nama klien<input type="text" bind:value={newName} oninput={onName} placeholder="Tadika Contoh" /></label>
    <label>Slug portal
      <span class="slug"><span>johorstudio.com/s/</span><input type="text" bind:value={newSlug} placeholder="tadika-contoh" /></span>
    </label>
    {#if createError}<span class="create-error" role="alert">{createError}</span>{/if}
    <div class="create-actions">
      <button type="button" class="ghost" onclick={() => (adding = false)}>Batal</button>
      <button type="submit" class="dark" disabled={creating}>{creating ? 'Menyimpan…' : 'Simpan klien'}</button>
    </div>
  </form>
{/if}
{#if copied}<p class="toast" role="status">{copied}</p>{/if}

{#each clients as client (client.id)}
  <section class="client">
    <div class="client-head">
      <div class="who">
        <h2>{client.name}</h2>
        <span class="portal">
          Portal: <strong>johorstudio.com/s/<em>{client.slug}</em></strong> · {client.albumCount} album · {formatCount(client.assetCount)} gambar
        </span>
      </div>
      <div class="client-actions">
        <button type="button" class="ghost" onclick={() => copy(`Link portal ${client.name}`, `/s/${client.slug}`)}>Salin link portal</button>
        <a class="ghost" href={`${base}/${client.slug}`}>Buka</a>
        <a class="dark" href={`${base}/admin/albums/new?client=${client.id}`}>+ Album</a>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Album</th>
            <th>Link album (untuk customer)</th>
            <th>Gambar</th>
            <th>Kamera</th>
            <th>Download</th>
            <th aria-label="Tindakan"></th>
          </tr>
        </thead>
        <tbody>
          {#each client.albums as album (album.id)}
            <tr>
              <td class="album-title">{album.title}</td>
              <td class="nowrap">/s/<em>{album.slug}</em></td>
              <td>{formatCount(album.assetCount)}</td>
              <td class="muted">{album.cameras.length > 1 ? album.cameras.join(', ') : album.cameras.length === 1 ? '1 kamera' : '—'}</td>
              <td>{album.allowDownload ? 'Buka' : 'Tutup'}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="ghost small" onclick={() => copy(`Link ${album.title}`, `/s/${album.slug}`)}>Salin</button>
                  <a class="ghost small" href={`${base}/admin/albums/${album.id}`}>Edit</a>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{:else}
  {#if !error}<p class="loading" aria-busy="true">Memuatkan klien…</p>{/if}
{/each}

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
