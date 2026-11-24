<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { AdminAlbumDetail, FolderRule, ThumbProgress } from '$lib/api/models';
  import type { ClientSummary } from '@gallery/shared';
  import { SLUG_REGEX } from '@gallery/shared';
  import { api, ApiError, isNotFound } from '$lib/api/client';
  import { formatCount } from '$lib/format';
  import Photo from '$lib/components/Photo.svelte';
  import FolderPicker from '$lib/components/FolderPicker.svelte';

  let detail = $state<AdminAlbumDetail | null>(null);
  let clients = $state<ClientSummary[]>([]);
  let rules = $state<FolderRule[]>([]);
  let thumbs = $state<ThumbProgress | null>(null);
  let thumbBusy = $state(false);
  let thumbNote = $state('');
  let deleting = $state(false);
  let stats = $state<{ assetCount: number; folderCount: number } | null>(null);
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

  // Thumbnail progress for a saved album; polls while anything is pending.
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

  async function forceThumbs() {
    if (thumbBusy || isNew) return;
    thumbBusy = true;
    thumbNote = '';
    try {
      const result = await api.forceAlbumThumbs(id);
      thumbNote = result.queued > 0 ? `${formatCount(result.queued)} gambar didahulukan. Siap sekejap lagi.` : 'Semua thumbnail dah siap.';
      thumbs = await api.getAlbumThumbs(id);
      if (thumbs.pending > 0) {
        const again = async () => {
          thumbs = await api.getAlbumThumbs(id).catch(() => thumbs);
          if (thumbs && thumbs.pending > 0 && page.params.id === id) setTimeout(again, 5000);
        };
        setTimeout(again, 5000);
      }
    } catch (cause) {
      thumbNote = cause instanceof ApiError ? cause.message : 'Gagal hantar. Cuba lagi.';
    } finally {
      thumbBusy = false;
    }
  }

  async function removeAlbum() {
    if (isNew || deleting || !detail) return;
    const ok = window.confirm(
      `Padam album "${detail.album.title}"?\n\nLink /s/${detail.album.slug} akan mati. Gambar asal dalam folder TIDAK dipadam.`
    );
    if (!ok) return;
    deleting = true;
    try {
      await api.deleteAlbum(id);
      await goto(`${base}/admin/clients`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Padam gagal. Cuba lagi.';
    } finally {
      deleting = false;
    }
  }

  const sortedRules = $derived([...rules].sort((a, b) => a.path.localeCompare(b.path)));

  // Live total for the current (unsaved) rules.
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const snapshot = rules.map(({ folderId, path, included }) => ({ folderId, path, included }));
    clearTimeout(statsTimer);
    if (snapshot.length === 0) {
      stats = { assetCount: 0, folderCount: 0 };
      return;
    }
    statsTimer = setTimeout(() => {
      api
        .previewScope(snapshot)
        .then((result) => (stats = result))
        .catch(() => (stats = null));
    }, 250);
  });

  $effect(() => {
    const albumId = id;
    if (albumId) void load(albumId);
  });

  async function load(albumId: string) {
    loading = true;
    error = '';
    try {
      if (albumId === 'new') {
        clients = await api.getAdminClients();
        clientId = page.url.searchParams.get('client') ?? clients[0]?.id ?? '';
        const folderId = page.url.searchParams.get('folder');
        const folderPath = page.url.searchParams.get('path');
        rules = folderId && folderPath ? [{ folderId, path: folderPath, included: true }] : [];
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
          rules,
          previews: [],
          totalAssets: 0,
          clients
        };
      } else {
        const response = await api.getAdminAlbum(albumId);
        detail = response;
        clients = response.clients;
        clientId = response.album.clientId;
        title = response.album.title;
        slug = response.album.slug;
        allowDownload = response.album.allowDownload;
        rules = response.rules;
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

  async function save() {
    if (saving) return;
    error = '';
    if (!clientId) return void (error = 'Pilih klien dulu.');
    if (!title.trim()) return void (error = 'Nama album tak boleh kosong.');
    if (!SLUG_REGEX.test(slug.trim())) {
      return void (error = 'Nama link mesti 3–60 aksara: huruf kecil, nombor dan sengkang.');
    }
    if (slugState === 'taken') return void (error = 'Nama link ni dah dipakai.');
    if (!rules.some((rule) => rule.included)) return void (error = 'Tick sekurang-kurangnya satu folder.');
    saving = true;
    try {
      await api.saveAlbum(isNew ? null : id, {
        clientId,
        title: title.trim(),
        slug: slug.trim(),
        allowDownload,
        rules
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
    {#if !isNew}
      <button class="danger" type="button" onclick={removeAlbum} disabled={deleting || loading}>
        {deleting ? 'Memadam…' : 'Padam album'}
      </button>
    {/if}
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
        <legend>Folder (dari /mnt/a/studio)</legend>
        <p class="hint">Tick folder = folder tu dan semua folder di dalamnya masuk album. Untick folder di dalam = keluarkan dari album.</p>
        <FolderPicker bind:rules />
      </fieldset>
    </section>

    <aside class="aside">
      <section class="panel">
        <h2>Dalam album</h2>
        <div class="folder-list">
          {#each sortedRules as rule (rule.folderId)}
            <div class:excluded={!rule.included}>
              <span>{rule.included ? '✓' : '✕'} {rule.path === '.' ? '/ (semua)' : rule.path}</span>
              <span class="count">{rule.included ? 'masuk' : 'keluar'}</span>
            </div>
          {:else}
            <p class="empty">Belum tick folder.</p>
          {/each}
        </div>
        <div class="total">
          <span>Jumlah</span>
          <span>{stats ? `${formatCount(stats.assetCount)} gambar · ${formatCount(stats.folderCount)} folder` : '…'}</span>
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

      {#if !isNew}
        <section class="panel">
          <h2>Thumbnail</h2>
          {#if thumbs}
            <div class="bar" aria-hidden="true">
              <span style:width={`${thumbs.total ? (thumbs.ready / thumbs.total) * 100 : 100}%`}></span>
            </div>
            <span class="thumb-line">
              {formatCount(thumbs.ready)} / {formatCount(thumbs.total)} siap{#if thumbs.failed > 0} · {formatCount(thumbs.failed)} gagal{/if}
            </span>
          {:else}
            <span class="muted">Menyemak…</span>
          {/if}
          <button class="force" type="button" onclick={forceThumbs} disabled={thumbBusy || !thumbs || thumbs.pending === 0}>
            {thumbBusy ? 'Menghantar…' : 'Jana thumbnail sekarang'}
          </button>
          {#if thumbNote}<span class="muted">{thumbNote}</span>{/if}
        </section>
      {/if}

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
  .danger {
    height: 44px;
    padding: 0 16px;
    border: 1px solid #e3b4af;
    border-radius: 6px;
    background: #fff;
    color: #8a2a24;
    font-size: 15px;
  }

  .danger:disabled,
  .force:disabled {
    opacity: 0.6;
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

  .folder-list .excluded {
    color: #8a2a24;
  }

  .hint {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--steel);
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
