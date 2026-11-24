<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { AdminStatusView } from '$lib/api/models';
  import { api, isUnauthorised } from '$lib/api/client';
  import { formatCount, formatLocalClock } from '$lib/format';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  let { active, children }: { active: 'timeline' | 'albums' | 'clients' | 'status'; children: import('svelte').Snippet } = $props();

  let status = $state<AdminStatusView | null>(null);

  onMount(async () => {
    try {
      status = await api.getAdminStatus();
    } catch (error) {
      if (!isUnauthorised(error)) console.error('status failed', error);
    }
  });

  const hotPercent = $derived.by(() => {
    if (!status?.hotCache || status.hotCache.capBytes <= 0) return 0;
    return Math.min(100, Math.round((status.hotCache.usedBytes / status.hotCache.capBytes) * 100));
  });

  const hotLabel = $derived(
    status?.hotCache
      ? `${Math.round(status.hotCache.usedBytes / 1024 ** 3)} / ${Math.round(status.hotCache.capBytes / 1024 ** 3)} GB`
      : '—'
  );

  const nav = [
    { key: 'timeline', label: 'Timeline', href: `${base}/admin`, icon: 'grid' },
    { key: 'albums', label: 'Albums', href: `${base}/admin/albums`, icon: 'albums' },
    { key: 'clients', label: 'Clients', href: `${base}/admin/clients`, icon: 'link' },
    { key: 'status', label: 'System status', href: `${base}/admin/status`, icon: 'pulse' }
  ] as const;
</script>

<div class="admin-theme shell">
  <nav aria-label="Menu admin" class="nav">
    <a href={`${base}/admin`} class="brand" aria-label="JohorStudio admin"><Logo width={150} /></a>
    <div class="links">
      {#each nav as item (item.key)}
        <a href={item.href} class:current={active === item.key} aria-current={active === item.key ? 'page' : undefined}>
          <Icon name={item.icon} size={18} strokeWidth={2} />
          {item.label}
        </a>
      {/each}
    </div>
    <div class="cache">
      <div class="cache-row"><span>Hot cache SSD</span><strong>{hotLabel}</strong></div>
      <div class="bar"><div class="fill" style:width={`${hotPercent}%`}></div></div>
      <span class="muted">Kept 30 days, then removed automatically</span>
      <span class="muted">Last scan: {status?.lastScanAt ? formatLocalClock(status.lastScanAt) : '—'} · {formatCount(status?.assets)} photos</span>
    </div>
  </nav>

  <main class="main">
    {@render children()}
  </main>
</div>

<style>
  .shell {
    display: flex;
    flex-wrap: wrap;
    min-height: 100vh;
    font-family: inherit;
    color: var(--graphite);
    background: var(--paper);
  }

  .nav {
    flex: 1 1 220px;
    max-width: 100%;
    position: sticky;
    top: 0;
    align-self: flex-start;
    height: 100vh;
    background: var(--graphite);
    color: #fff;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .brand {
    margin-left: 8px;
    align-self: flex-start;
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 15px;
  }

  .links a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 6px;
    color: var(--mist);
  }

  .links a:hover {
    color: #fff;
    background: #2c353a;
  }

  .links a.current {
    background: var(--teal-ink);
    color: #fff;
    font-weight: 600;
  }

  .cache {
    margin-top: auto;
    background: #2c353a;
    border-radius: 6px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  .cache-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .bar {
    height: 6px;
    background: #46525a;
    border-radius: 3px;
    overflow: hidden;
  }

  .fill {
    height: 6px;
    background: var(--teal);
    border-radius: 3px;
  }

  .muted {
    color: #c3ccce;
    font-size: 12px;
  }

  .main {
    flex: 999 1 560px;
    min-width: 0;
    padding: 24px 32px 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  @media (max-width: 640px) {
    .nav {
      position: static;
      height: auto;
      flex-basis: 100%;
      padding: 14px 12px;
      gap: 14px;
    }

    .cache {
      order: 3;
    }

    .links {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .main {
      padding: 20px 16px 32px;
      flex-basis: 100%;
    }
  }
</style>
