<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { AdminFolderView } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatCount, formatDayMonth } from '$lib/format';
  import JustifiedGrid from '$lib/components/JustifiedGrid.svelte';
  import Photo from '$lib/components/Photo.svelte';
  import AdminViewer from '$lib/components/AdminViewer.svelte';

  let view = $state<AdminFolderView | null>(null);
  let error = $state('');
  let viewerId = $state<string | null>(null);

  const folderId = $derived(page.url.searchParams.get('folder') ?? undefined);

  $effect(() => {
    const id = folderId;
    void load(id);
  });

  async function load(id: string | undefined) {
    error = '';
    try {
      view = await api.getAdminFolder(id);
    } catch (cause) {
      console.error('folder gagal', cause);
      error = 'Folder tak dapat dimuatkan.';
    }
  }

  function openFolder(id: string) {
    void goto(`${base}/admin/folders?folder=${encodeURIComponent(id)}`);
  }

  const totalAssets = $derived(
    (view?.folders ?? []).reduce((sum, folder) => sum + folder.assetCount, 0) + (view?.assetCount ?? 0)
  );
  const albumHref = $derived(
    `${base}/admin/albums/new?folder=${encodeURIComponent(view?.id ?? '')}&path=${encodeURIComponent(view?.path ?? '')}`
  );
</script>

<svelte:head>
  <title>Timeline folder · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <h1>Timeline</h1>
  <div role="group" aria-label="Mod paparan" class="segmented">
    <a href={`${base}/admin`}>Tarikh</a>
    <a href={`${base}/admin/folders`} class="on" aria-current="page">Folder</a>
  </div>
  <nav aria-label="Laluan folder" class="crumbs">
    <a href={`${base}/admin/folders`}>studio</a>
    {#each view?.breadcrumb ?? [] as crumb, index (crumb.id)}
      {#if index > 0 || crumb.path !== '.'}
        <span aria-hidden="true">/</span>
        {#if index === (view?.breadcrumb.length ?? 0) - 1}
          <span class="current">{crumb.name}</span>
        {:else}
          <a href={`${base}/admin/folders?folder=${encodeURIComponent(crumb.id)}`}>{crumb.name}</a>
        {/if}
      {/if}
    {/each}
  </nav>
</header>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

<div class="body">
  <aside aria-label="Pokok folder" class="tree">
    <span class="root">/mnt/a/studio</span>
    {#each view?.tree ?? [] as node (node.id)}
      <a
        href={`${base}/admin/folders?folder=${encodeURIComponent(node.id)}`}
        class:current={node.id === view?.id}
        style:padding-left={`${8 + node.depth * 16}px`}
        onclick={(event) => {
          event.preventDefault();
          openFolder(node.id);
        }}>{node.name}</a
      >
    {/each}
  </aside>

  <div class="content">
    <div class="tools">
      <span>{formatCount(view?.folderCount)} folder · {formatCount(totalAssets)} gambar</span>
      <a class="create" href={albumHref}>+ Buat album dari folder dipilih</a>
    </div>

    {#if view}
      <div class="cards">
        {#each view.folders as folder (folder.id)}
          <a
            href={`${base}/admin/folders?folder=${encodeURIComponent(folder.id)}`}
            class="card"
            onclick={(event) => {
              event.preventDefault();
              openFolder(folder.id);
            }}
          >
            <div class="thumbs">
              {#each Array(4) as _, index (index)}
                {@const cover = folder.covers[index]}
                <span class="thumb">
                  {#if cover}<Photo asset={cover} theme="light" />{/if}
                </span>
              {/each}
            </div>
            <div class="card-text">
              <span class="name">{folder.name}</span>
              <span class="meta">{formatCount(folder.assetCount)} gambar · {formatDayMonth(folder.lastTakenAt)}</span>
            </div>
          </a>
        {/each}
      </div>

      <h2 class="loose-head">Gambar terus dalam {view.breadcrumb.at(-1)?.name ?? 'studio'}</h2>
      <JustifiedGrid assets={view.loose} targetRowHeight={140} gap={4} theme="light" ariaLabel="Gambar dalam folder" onopen={(id) => (viewerId = id)} />
    {:else if !error}
      <p class="loading" aria-busy="true">Memuatkan folder…</p>
    {/if}
  </div>
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }

  h1 {
    font-size: 30px;
    font-weight: 700;
    font-stretch: 85%;
  }

  .segmented {
    display: flex;
    background: var(--mist);
    border-radius: 6px;
    padding: 3px;
  }

  .segmented a {
    padding: 8px 16px;
    border-radius: 4px;
    color: var(--steel);
    font-size: 14px;
  }

  .segmented a.on {
    background: #fff;
    color: var(--graphite);
    font-weight: 600;
  }

  .crumbs {
    display: flex;
    gap: 6px;
    font-size: 14px;
    color: var(--steel);
    flex-wrap: wrap;
  }

  .crumbs .current {
    color: var(--graphite);
    font-weight: 600;
  }

  .error {
    margin: 0;
    padding: 10px 12px;
    background: #f8e3e1;
    color: #8a2a24;
    border-radius: 6px;
    font-size: 14px;
  }

  .body {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-start;
  }

  .tree {
    flex: 1 1 220px;
    max-width: 280px;
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    padding: 12px;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .root {
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--steel);
    letter-spacing: 0.06em;
  }

  .tree a {
    padding: 8px;
    border-radius: 4px;
    color: var(--graphite);
  }

  .tree a:hover {
    background: #f0f4f4;
  }

  .tree a.current {
    background: var(--teal-soft);
    color: var(--teal-ink);
    font-weight: 600;
  }

  .content {
    flex: 999 1 480px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .tools {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 14px;
    color: var(--steel);
  }

  .create {
    height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    background: var(--graphite);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    padding: 10px;
    color: var(--graphite);
  }

  .card:hover {
    border-color: #c4ccce;
  }

  .thumbs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
  }

  .thumb {
    position: relative;
    height: 84px;
    border-radius: 2px;
    background: linear-gradient(135deg, #d8cfc4, #9fb0a8);
    overflow: hidden;
  }

  .card-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 2px 2px;
  }

  .name {
    font-size: 15px;
    font-weight: 600;
  }

  .meta {
    font-size: 13px;
    color: var(--steel);
  }

  .loose-head {
    margin-top: 12px;
    font-size: 17px;
    font-weight: 600;
  }

  .loading {
    color: var(--steel);
    font-size: 14px;
  }

  @media (max-width: 700px) {
    .tree {
      max-width: none;
      flex-basis: 100%;
      order: 2;
    }
  }
</style>

{#if viewerId && view}
  <AdminViewer items={view.loose} id={viewerId} onclose={() => (viewerId = null)} onchange={(id) => (viewerId = id)} />
{/if}
