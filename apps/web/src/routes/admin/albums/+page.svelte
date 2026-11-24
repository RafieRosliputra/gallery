<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { AdminAlbum } from '@gallery/shared';
  import { api } from '$lib/api/client';
  import { formatCount } from '$lib/format';
  import Photo from '$lib/components/Photo.svelte';

  let albums = $state<AdminAlbum[]>([]);
  let error = $state('');

  onMount(async () => {
    try {
      albums = (await api.getAdminAlbums()).albums;
    } catch (cause) {
      console.error('album gagal', cause);
      error = 'Senarai album tak dapat dimuatkan.';
    }
  });
</script>

<svelte:head>
  <title>Album · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <div class="titles">
    <h1>Album</h1>
    <span>Satu album boleh ambil gambar dari banyak folder. Fail asal tak dipindah.</span>
  </div>
  <a class="new" href={`${base}/admin/albums/new`}>+ Album baru</a>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="grid">
  {#each albums as album (album.id)}
    {@const first = album.covers?.[0]}
    <a class="card" href={`${base}/admin/albums/${album.id}`}>
      <div class="covers">
        <span class="cover main">
          {#if first}<Photo asset={first} theme="light" />{/if}
        </span>
        <span class="side">
          {#each [1, 2] as slot (slot)}
            {@const cover = album.covers?.[slot]}
            <span class="cover">
              {#if cover}<Photo asset={cover} theme="light" />{/if}
            </span>
          {/each}
        </span>
      </div>
      <div class="text">
        <span class="title">{album.title}</span>
        <span class="meta">{album.folderCount} folder · {formatCount(album.assetCount)} gambar</span>
        {#if album.slug}
          <span class="badge">/s/{album.slug}</span>
        {:else}
          <span class="badge empty">Belum ada link</span>
        {/if}
      </div>
    </a>
  {/each}
</div>

{#if !albums.length && !error}
  <p class="loading" aria-busy="true">Memuatkan album…</p>
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
    border-radius: 6px;
    background: var(--teal-ink);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
  }

  .error {
    margin: 0;
    padding: 10px 12px;
    background: #f8e3e1;
    color: #8a2a24;
    border-radius: 6px;
    font-size: 14px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
    margin-top: 4px;
  }

  .card {
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    overflow: hidden;
    color: var(--graphite);
  }

  .card:hover {
    border-color: #c4ccce;
  }

  .covers {
    display: flex;
    gap: 3px;
    height: 170px;
  }

  .cover {
    position: relative;
    flex: 1;
    background: linear-gradient(135deg, #d8cfc4, #9fb0a8);
    overflow: hidden;
  }

  .cover.main {
    flex: 2;
  }

  .side {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .text {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
  }

  .meta {
    font-size: 13px;
    color: var(--steel);
  }

  .badge {
    align-self: flex-start;
    font-size: 13px;
    font-weight: 600;
    color: var(--teal-ink);
    background: var(--teal-soft);
    padding: 4px 8px;
    border-radius: 4px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge.empty {
    color: var(--steel);
    background: var(--mist);
    font-weight: 400;
  }

  .loading {
    color: var(--steel);
    font-size: 14px;
  }
</style>
