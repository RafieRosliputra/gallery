<script lang="ts">
  // Album folder picker: the whole /mnt/a/studio tree, loaded lazily.
  // Ticking a folder includes it and everything inside it; unticking a folder
  // inside a ticked one carves that subtree back out. State is stored as the
  // minimal rule list (a rule only where a folder differs from its parent).
  import { onMount } from 'svelte';
  import type { FolderRule, PickerFolder } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatCount } from '$lib/format';

  let { rules = $bindable([]) }: { rules: FolderRule[] } = $props();

  let rootId = $state('');
  let children = $state<Record<string, PickerFolder[]>>({});
  let open = $state<Record<string, boolean>>({});
  let busy = $state<Record<string, boolean>>({});
  let error = $state('');

  const covers = (rulePath: string, folderPath: string) =>
    rulePath === folderPath || rulePath === '.' || folderPath.startsWith(`${rulePath}/`);
  const inside = (folderPath: string, parentPath: string) =>
    parentPath === '.' ? folderPath !== '.' : folderPath.startsWith(`${parentPath}/`);

  /** Included state of a folder; `skipId` ignores that folder's own rule. */
  function isOn(folder: { id: string; path: string }, skipId?: string): boolean {
    let best: FolderRule | null = null;
    let bestLength = -1;
    for (const rule of rules) {
      if (rule.folderId === skipId || !covers(rule.path, folder.path)) continue;
      const length = rule.folderId === folder.id ? Number.MAX_SAFE_INTEGER : rule.path === '.' ? 0 : rule.path.length + 1;
      if (length > bestLength) {
        best = rule;
        bestLength = length;
      }
    }
    return best?.included ?? false;
  }

  /** Some folder inside differs from this one → show the dash. */
  function mixed(folder: PickerFolder, on: boolean): boolean {
    return rules.some((rule) => inside(rule.path, folder.path) && rule.included !== on);
  }

  function toggle(folder: PickerFolder) {
    const next = !isOn(folder);
    const kept = rules.filter((rule) => rule.folderId !== folder.id && !inside(rule.path, folder.path));
    rules = kept;
    if (isOn(folder) !== next) {
      rules = [...kept, { folderId: folder.id, path: folder.path, included: next }];
    }
  }

  async function load(parentId?: string): Promise<PickerFolder[]> {
    const key = parentId ?? 'root';
    if (children[key]) return children[key];
    busy = { ...busy, [key]: true };
    try {
      const response = await api.getFolderChildren(parentId);
      if (!parentId && response.parent) rootId = response.parent.id;
      children = { ...children, [parentId ?? response.parent?.id ?? 'root']: response.folders };
      // Open folders that hold a rule deeper down so saved albums show their state.
      for (const folder of response.folders) {
        if (folder.hasChildren && rules.some((rule) => inside(rule.path, folder.path))) void expand(folder, true);
      }
      return response.folders;
    } catch (cause) {
      console.error('folder gagal', cause);
      error = 'Folder tak dapat dimuatkan.';
      return [];
    } finally {
      busy = { ...busy, [key]: false };
    }
  }

  async function expand(folder: PickerFolder, force = false) {
    const next = force ? true : !open[folder.id];
    open = { ...open, [folder.id]: next };
    if (next) await load(folder.id);
  }

  onMount(() => {
    void load();
  });

  interface Row {
    folder: PickerFolder;
    depth: number;
  }

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (list: PickerFolder[] | undefined, depth: number) => {
      for (const folder of list ?? []) {
        out.push({ folder, depth });
        if (open[folder.id]) walk(children[folder.id], depth + 1);
      }
    };
    walk(children[rootId], 0);
    return out;
  });
</script>

<div class="picker" role="tree" aria-label="Folder dalam /mnt/a/studio">
  {#if error}<p class="error">{error}</p>{/if}
  {#each rows as { folder, depth } (folder.id)}
    {@const on = isOn(folder)}
    {@const partial = mixed(folder, on)}
    <div class="row" role="treeitem" aria-selected={on} aria-expanded={folder.hasChildren ? Boolean(open[folder.id]) : undefined} style:padding-left={`${4 + depth * 22}px`}>
      {#if folder.hasChildren}
        <button
          type="button"
          class="caret"
          class:open={open[folder.id]}
          aria-label={open[folder.id] ? `Tutup ${folder.name}` : `Buka ${folder.name}`}
          onclick={() => expand(folder)}
        >
          {busy[folder.id] ? '…' : '›'}
        </button>
      {:else}
        <span class="caret-space"></span>
      {/if}
      <label class:off={!on}>
        <input type="checkbox" checked={on} indeterminate={partial} onchange={() => toggle(folder)} />
        <span class="name">{folder.name}</span>
        <span class="count">{folder.totalCount ? formatCount(folder.totalCount) : ''}</span>
      </label>
    </div>
  {:else}
    <p class="muted">{busy['root'] ? 'Memuatkan folder…' : 'Tiada folder.'}</p>
  {/each}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    max-height: 60vh;
    overflow: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 40px;
    border-radius: 4px;
  }
  .row:hover {
    background: #f6f8f8;
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
    font-size: 15px;
    cursor: pointer;
  }
  label.off .name {
    color: var(--steel);
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
  .count {
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
