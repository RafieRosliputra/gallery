<script lang="ts">
  // Folder tree for albums. Every album is one ticked folder (its root rule);
  // inside an album each subfolder has a Visible / Hidden switch, stored as
  // exclude/include rules of that album.
  //  - mode "client": the whole library; ticking a folder makes it an album,
  //    unticking removes that album.
  //  - mode "album": only the album's own folder and what is inside it.
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import type { ClientAlbum, FolderRule, PickerFolder } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatCount } from '$lib/format';

  let {
    albums = $bindable([]),
    mode = 'client',
    rootFolderId = undefined,
    ontick = undefined,
    onuntick = undefined,
    onchange = undefined
  }: {
    albums: ClientAlbum[];
    mode?: 'client' | 'album';
    rootFolderId?: string;
    ontick?: (folder: PickerFolder) => void | Promise<void>;
    onuntick?: (album: ClientAlbum) => void | Promise<void>;
    onchange?: (album: ClientAlbum) => void | Promise<void>;
  } = $props();

  let top = $state<PickerFolder[]>([]);
  let children = $state<Record<string, PickerFolder[]>>({});
  let open = $state<Record<string, boolean>>({});
  let busy = $state<Record<string, boolean>>({});
  let loadingTop = $state(true);
  let error = $state('');

  const under = (child: string, parent: string) =>
    parent === '.' ? child !== '.' : child.startsWith(`${parent}/`);
  const coversPath = (rulePath: string, folderPath: string) => rulePath === folderPath || under(folderPath, rulePath);

  /** The album's own folder: its shallowest included rule. */
  function rootOf(album: ClientAlbum): FolderRule | undefined {
    return album.rules
      .filter((rule) => rule.included)
      .sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : a.path.split('/').length - b.path.split('/').length))[0];
  }

  /** Album whose folder is this folder or contains it (deepest wins). */
  function ownerOf(folder: PickerFolder): { album: ClientAlbum; root: FolderRule } | null {
    let best: { album: ClientAlbum; root: FolderRule } | null = null;
    for (const album of albums) {
      const root = rootOf(album);
      if (!root || !coversPath(root.path, folder.path)) continue;
      if (!best || root.path.length > best.root.path.length) best = { album, root };
    }
    return best;
  }

  function visible(rules: FolderRule[], folder: PickerFolder): boolean {
    let best: FolderRule | null = null;
    let bestLength = -1;
    for (const rule of rules) {
      if (!coversPath(rule.path, folder.path)) continue;
      const length = rule.folderId === folder.id ? Number.MAX_SAFE_INTEGER : rule.path === '.' ? 0 : rule.path.length + 1;
      if (length > bestLength) {
        best = rule;
        bestLength = length;
      }
    }
    return best?.included ?? false;
  }

  function toggleVisible(album: ClientAlbum, folder: PickerFolder) {
    const next = !visible(album.rules, folder);
    const kept = album.rules.filter((rule) => rule.folderId !== folder.id && !under(rule.path, folder.path));
    const rules = visible(kept, folder) === next ? kept : [...kept, { folderId: folder.id, path: folder.path, included: next }];
    const updated = { ...album, rules };
    albums = albums.map((candidate) => (candidate.id === album.id ? updated : candidate));
    void onchange?.(updated);
  }

  const holdsAlbum = (folder: PickerFolder) =>
    albums.some((album) => {
      const root = rootOf(album);
      return root ? under(root.path, folder.path) : false;
    });
  const hiddenInside = (album: ClientAlbum, folder: PickerFolder) =>
    album.rules.some((rule) => !rule.included && under(rule.path, folder.path));
  const keep = (folder: PickerFolder) =>
    folder.totalCount > 0 || albums.some((album) => album.rules.some((rule) => coversPath(folder.path, rule.path)));

  async function load(parentId: string | undefined): Promise<void> {
    const key = parentId ?? 'root';
    if (children[key] || busy[key]) return;
    busy = { ...busy, [key]: true };
    try {
      const response = await api.getFolderChildren(parentId);
      children = { ...children, [key]: response.folders };
      if (mode === 'album' && parentId === rootFolderId && response.parent) top = [response.parent];
      if (mode === 'client' && !parentId) top = response.folders;
      // Open folders that hold an album or a hidden subfolder deeper down.
      for (const folder of response.folders) {
        const deeper = albums.some((album) => album.rules.some((rule) => under(rule.path, folder.path)));
        if (folder.hasChildren && deeper) void expand(folder, true);
      }
    } catch (cause) {
      console.error('folder load failed', cause);
      error = 'Could not load folders.';
    } finally {
      busy = { ...busy, [key]: false };
      if (key === (mode === 'album' ? rootFolderId : 'root')) loadingTop = false;
    }
  }

  async function expand(folder: PickerFolder, force = false) {
    const next = force ? true : !open[folder.id];
    open = { ...open, [folder.id]: next };
    if (next) await load(folder.id);
  }

  onMount(() => {
    if (mode === 'album') {
      if (rootFolderId) {
        void load(rootFolderId).then(() => {
          const root = top[0];
          if (root) open = { ...open, [root.id]: true };
        });
      }
    } else {
      void load(undefined);
    }
  });

  interface Row {
    folder: PickerFolder;
    depth: number;
  }

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (list: PickerFolder[] | undefined, depth: number) => {
      for (const folder of list ?? []) {
        if (!keep(folder)) continue;
        out.push({ folder, depth });
        if (open[folder.id]) walk(children[folder.id], depth + 1);
      }
    };
    walk(top, 0);
    return out;
  });
</script>

<div class="tree" role="tree" aria-label="Folders">
  {#if error}<p class="error">{error}</p>{/if}
  {#each rows as { folder, depth } (folder.id)}
    {@const owner = ownerOf(folder)}
    {@const isRoot = owner !== null && owner.root.path === folder.path}
    {@const shown = owner ? visible(owner.album.rules, folder) : false}
    <div
      class="row"
      class:album={isRoot}
      class:hidden={owner !== null && !isRoot && !shown}
      role="treeitem"
      aria-selected={isRoot}
      aria-expanded={folder.hasChildren ? Boolean(open[folder.id]) : undefined}
      style:padding-left={`${4 + depth * 22}px`}
    >
      {#if folder.hasChildren}
        <button
          type="button"
          class="caret"
          class:open={open[folder.id]}
          aria-label={open[folder.id] ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          onclick={() => expand(folder)}
        >
          {busy[folder.id] ? '…' : '›'}
        </button>
      {:else}
        <span class="caret-space"></span>
      {/if}

      {#if owner && !isRoot}
        <button
          type="button"
          class="eye"
          class:off={!shown}
          aria-pressed={!shown}
          title={shown ? 'Visible to the public — click to hide' : 'Hidden from the public — click to show'}
          onclick={() => toggleVisible(owner.album, folder)}
        >
          {shown ? 'Visible' : 'Hidden'}
        </button>
        <span class="name">{folder.name}</span>
      {:else if mode === 'client'}
        <label>
          <input
            type="checkbox"
            checked={isRoot}
            indeterminate={!isRoot && holdsAlbum(folder)}
            onchange={(event) => {
              const box = event.currentTarget as HTMLInputElement;
              box.checked = isRoot;
              if (isRoot && owner) void onuntick?.(owner.album);
              else void ontick?.(folder);
            }}
          />
          <span class="name">{folder.name}</span>
        </label>
      {:else}
        <span class="name strong">{folder.name}</span>
      {/if}

      {#if isRoot && owner}
        <span class="badge">{hiddenInside(owner.album, folder) ? 'Album · some hidden' : 'Album'}</span>
        {#if mode === 'client'}
          <a class="edit" href={`${base}/admin/albums/${owner.album.id}`}>Edit</a>
        {/if}
      {/if}
      <span class="count">{folder.totalCount ? formatCount(folder.totalCount) : ''}</span>
    </div>
  {:else}
    <p class="muted">{loadingTop ? 'Loading folders…' : 'No folders.'}</p>
  {/each}
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    max-height: 64vh;
    overflow: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    border-radius: 4px;
    font-size: 15px;
  }
  .row:hover {
    background: #f6f8f8;
  }
  .row.album {
    background: #e8f3f1;
  }
  .row.hidden .name {
    color: var(--steel);
    text-decoration: line-through;
  }
  .caret,
  .caret-space {
    width: 30px;
    height: 30px;
    flex: none;
  }
  .caret {
    border: 0;
    background: transparent;
    font-size: 20px;
    line-height: 1;
    color: var(--steel);
    cursor: pointer;
    transition: transform 120ms;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  label {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  input {
    width: 18px;
    height: 18px;
    accent-color: var(--teal-ink);
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .strong {
    font-weight: 600;
  }
  .eye {
    flex: none;
    min-width: 72px;
    height: 28px;
    border: 1px solid #b9d9d3;
    border-radius: 14px;
    background: #fff;
    color: var(--teal-ink);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .eye.off {
    border-color: #e3b4af;
    color: #8a2a24;
    background: #fbefed;
  }
  .badge {
    flex: none;
    font-size: 12px;
    font-weight: 600;
    color: var(--teal-ink);
  }
  .edit {
    flex: none;
    font-size: 13px;
  }
  .count {
    flex: none;
    font-size: 13px;
    color: var(--steel);
    padding-right: 8px;
  }
  .error {
    color: #8a2a24;
    font-size: 14px;
  }
  .muted {
    color: var(--steel);
    font-size: 14px;
  }
</style>
