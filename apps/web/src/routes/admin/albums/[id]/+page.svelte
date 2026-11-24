<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { AdminAlbumDetail, AdminFolderNode, AdminTreeEntry } from '$lib/api/models';
  import type { ClientSummary } from '@gallery/shared';
  import { SLUG_REGEX } from '@gallery/shared';
  import { api, ApiError, isNotFound } from '$lib/api/client';
  import { formatCount } from '$lib/format';
  import Photo from '$lib/components/Photo.svelte';

  let detail = $state<AdminAlbumDetail | null>(null);
  let clients = $state<ClientSummary[]>([]);
  let selected = $state<string[]>([]);
  let clientId = $state('');
  let title = $state('');
  let slug = $state('');
  let allowDownload = $state(true);
  let slugTouched = $state(false);
  let slugState = $state<'idle' | 'checking' | 'free' | 'taken'>('idle');
  let saving = $state(false);
  let error = $state('');
  let loading = $state(true);

  const id = $derived(page.params.id ?? '');
  const isNew = $derived(id === 'new');

  const folderNodes = $derived<AdminFolderNode[]>(detail?.folders ?? []);
  const selectedNodes = $derived(folderNodes.filter((node) => selected.includes(node.id)));
  const totalSelected = $derived(selectedNodes.reduce((sum, node) => sum + node.assetCount, 0));

  $effect(() => {
    const albumId = id;
    if (albumId) void load(albumId);
  });

  async function load(albumId: string) {
    loading = true;
    error = '';
    try {
      if (albumId === 'new') {
        const [clientResponse, folderView] = await Promise.all([
          api.getAdminClients(),
          api.getAdminFolder()
        ]);
        clients = clientResponse;
        clientId = page.url.searchParams.get('client') ?? clients[0]?.id ?? '';
        const preselected = page.url.searchParams.get('folders');
        const nodes: AdminFolderNode[] = folderView.tree.map((node: AdminTreeEntry) => ({
          ...node,
          hasChildren: node.folderCount > 0,
          selected: preselected ? node.path === preselected : false
        }));
        detail = {
          album: {
            id: 'new',
            title: '',
            slug: '',
            clientId: '',
            clientName: '',
            clientSlug: '',
            allowDownload: true,
            assetCount: 0,
            folderCount: 0,
            coverAssetIds: [],
            covers: [],
            cameras: [],
            takenAt: null,
            createdAt: ''
          },
          folders: nodes,
          previews: [],
          totalAssets: 0,
          clients
        };
        selected = nodes.filter((node) => node.selected).map((node) => node.id);
      } else {
        const response = await api.getAdminAlbum(albumId);
        detail = response;
        clients = response.clients;
        clientId = response.album.clientId;
        title = response.album.title;
        slug = response.album.slug;
        allowDownload = response.album.allowDownload;
        selected = response.folders.filter((node) => node.selected).map((node) => node.id);
        slugState = 'free';
      }
    } catch (cause) {
      console.error('album edit gagal', cause);
      error = isNotFound(cause) ? 'Album ni tak dijumpai.' : 'Album tak dapat dimuatkan.';
    } finally {
      loading = false;
    }
  }

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function onClientChange() {
    if (clientId === '__new') {
      error = 'Tambah klien baru di halaman Klien, lepas tu kembali sini.';
      clientId = clients[0]?.id ?? '';
    }
  }

  function onTitleInput() {
    if (!slugTouched && isNew) {
      slug = slugify(title);
      void checkSlug();
    }
  }

  let slugTimer: ReturnType<typeof setTimeout> | undefined;

  function onSlugInput() {
    slugTouched = true;
    void checkSlug();
  }

  async function checkSlug() {
    clearTimeout(slugTimer);
    const candidate = slug.trim();
    if (!SLUG_REGEX.test(candidate)) {
      slugState = 'idle';
      return;
    }
    if (!isNew && candidate === detail?.album.slug) {
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

  function toggleNode(nodeId: string) {
    selected = selected.includes(nodeId)
      ? selected.filter((value) => value !== nodeId)
      : [...selected, nodeId];
  }

  async function save() {
    if (saving) return;
    error = '';
    if (!clientId) return void (error = 'Pilih klien dulu.');
    if (!title.trim()) return void (error = 'Nama album tak boleh kosong.');
    if (!SLUG_REGEX.test(slug.trim())) {
      return void (error = 'Nama link mesti 3–60 aksara: huruf kecil, nombor dan sengkang.');
    }
    if (slugState === 'taken') return void (error = 'Nama link ni dah dipakai.');
    saving = true;
    try {
      await api.saveAlbum(isNew ? null : id, {
        clientId,
        title: title.trim(),
        slug: slug.trim(),
        allowDownload,
        folderIds: selected
      });
      await goto(`${base}/admin/clients`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Simpan gagal. Cuba lagi.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>{isNew ? 'Album baru' : 'Edit album'} · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <div class="titles">
    <a href={`${base}/admin/albums`}>← Album</a>
    <h1>{isNew ? 'Album baru' : 'Edit album'}</h1>
  </div>
  <div class="actions">
    <a class="cancel" href={`${base}/admin/albums`}>Batal</a>
    <button class="save" type="button" onclick={save} disabled={saving || loading}>
      {saving ? 'Menyimpan…' : 'Simpan'}
    </button>
  </div>
</header>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if loading}
  <p class="loading" aria-busy="true">Memuatkan album…</p>
{:else if detail}
  <div class="body">
    <section class="form">
      <label>
        Klien
        <select bind:value={clientId} onchange={onClientChange}>
          {#each clients as client (client.id)}
            <option value={client.id}>{client.name} (/s/{client.slug})</option>
          {/each}
          <option value="__new">+ Klien baru</option>
        </select>
      </label>

      <label>
        Nama album
        <input type="text" bind:value={title} oninput={onTitleInput} placeholder="Contoh: Sanding" />
      </label>

      <fieldset>
        <legend>Pilih folder (dari /mnt/a/studio)</legend>
        {#each folderNodes as node (node.id)}
          <label class="tree-row" style:padding-left={`${8 + node.depth * 20}px`}>
            <input
              type="checkbox"
              checked={selected.includes(node.id)}
              onchange={() => toggleNode(node.id)}
            />
            <span class="tree-name">{node.name}</span>
            <span class="tree-count">{node.folderCount === 0 && node.assetCount ? formatCount(node.assetCount) : ''}</span>
          </label>
        {/each}
      </fieldset>
    </section>

    <aside class="aside">
      <section class="panel">
        <h2>Folder dalam album ({selectedNodes.length})</h2>
        <div class="folder-list">
          {#each selectedNodes as node (node.id)}
            <div><span>{node.path}</span><span class="count">{formatCount(node.assetCount)}</span></div>
          {:else}
            <p class="empty">Belum pilih folder.</p>
          {/each}
        </div>
        <div class="total"><span>Jumlah</span><span>{formatCount(totalSelected)} gambar</span></div>
        {#if detail.album.cameras.length > 1}
          <span class="camera-note">Subfolder Cam 1 / Cam 2 dikesan → klien nampak tab Semua · Cam 1 · Cam 2</span>
        {/if}
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
        <h2>Link album (untuk customer klien)</h2>
        <label>
          Nama link
          <span class="slug-field">
            <span class="prefix">johorstudio.com/s/</span>
            <input type="text" bind:value={slug} oninput={onSlugInput} placeholder="nama-link" />
          </span>
        </label>
        {#if slugState === 'free'}
          <span class="ok">✓ Nama ni belum dipakai</span>
        {:else if slugState === 'taken'}
          <span class="bad">Nama ni dah dipakai. Pilih yang lain.</span>
        {:else if slugState === 'checking'}
          <span class="muted">Menyemak nama…</span>
        {/if}
        <label class="download-row">
          Benarkan klien download
          <input type="checkbox" bind:checked={allowDownload} />
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
  .save {
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

  .save:disabled {
    opacity: 0.65;
  }

  .error {
    margin: 0;
    padding: 10px 12px;
    background: #f8e3e1;
    color: #8a2a24;
    border-radius: 6px;
    font-size: 14px;
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
    gap: 4px;
  }

  legend {
    font-size: 14px;
    font-weight: 600;
    padding: 0 6px;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    font-size: 15px;
    font-weight: 400;
    border-radius: 4px;
  }

  .tree-row:hover {
    background: #f6f8f8;
  }

  .tree-row input {
    width: 18px;
    height: 18px;
    accent-color: var(--teal-ink);
    flex: none;
  }

  .tree-name {
    flex: 1;
  }

  .tree-count {
    font-size: 13px;
    color: var(--steel);
    padding-right: 8px;
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

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 14px;
  }

  .folder-list > div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .folder-list .count {
    color: var(--steel);
    flex: none;
  }

  .empty {
    color: var(--steel);
    font-size: 14px;
  }

  .total {
    border-top: 1px solid var(--mist);
    padding-top: 10px;
    display: flex;
    justify-content: space-between;
    font-size: 15px;
    font-weight: 600;
  }

  .camera-note {
    font-size: 13px;
    color: var(--teal-ink);
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
