<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import AdminShell from '$lib/components/AdminShell.svelte';

  let ready = $state(false);
  let { children } = $props();

  const section = $derived.by(() => {
    const path = page.url.pathname;
    if (path.includes('/admin/albums')) return 'albums';
    if (path.includes('/admin/clients')) return 'clients';
    if (path.includes('/admin/status')) return 'status';
    return 'timeline';
  });

  onMount(async () => {
    try {
      await api.getSession();
      ready = true;
    } catch {
      const next = page.url.pathname + page.url.search;
      await goto(`${base}?next=${encodeURIComponent(next)}`, { replaceState: true });
    }
  });
</script>

{#if ready}
  <AdminShell active={section}>
    {@render children()}
  </AdminShell>
{:else}
  <div class="admin-theme loading" aria-busy="true">
    <span class="sr-only">Menyemak sesi…</span>
  </div>
{/if}

<style>
  .loading {
    min-height: 100vh;
    background: var(--paper);
  }
</style>
