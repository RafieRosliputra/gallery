<script lang="ts">
  import { onMount } from 'svelte';
  import type { AdminBucketsResponse, AdminStatusView, Asset, BucketRef } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatCount, formatLocalClock } from '$lib/format';
  import Icon from '$lib/components/Icon.svelte';
  import JustifiedGrid from '$lib/components/JustifiedGrid.svelte';
  import AdminViewer from '$lib/components/AdminViewer.svelte';

  let status = $state<AdminStatusView | null>(null);
  let bucketData = $state<AdminBucketsResponse | null>(null);
  let days = $state<Record<string, Asset[]>>({});
  let query = $state('');
  let notice = $state('');
  let busy = $state(false);
  let viewerId = $state<string | null>(null);


  const visible = $derived(
    (bucketData?.buckets ?? []).filter((bucket) => {
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return `${bucket.label ?? ''} ${bucket.sub ?? ''} ${bucket.key}`.toLowerCase().includes(needle);
    })
  );

  // One flat list in screen order so ← → walks across days.
  const loadedItems = $derived(visible.flatMap((bucket) => days[bucket.key] ?? []));

  const activeMonth = $derived((bucketData?.buckets[0]?.key ?? '').slice(0, 7));

  const years = $derived.by(() => {
    const groups = new Map<number, { key: string; label: string }[]>();
    for (const bucket of bucketData?.buckets ?? []) {
      const year = bucket.year ?? Number(bucket.key.slice(0, 4));
      const label = bucket.monthLabel ?? '—';
      const key = bucket.key.slice(0, 7);
      const list = groups.get(year) ?? [];
      if (!list.some((entry) => entry.key === key)) list.push({ key, label });
      groups.set(year, list);
    }
    return [...groups.entries()].map(([year, months]) => ({ year, months }));
  });

  onMount(load);

  async function load() {
    try {
      const [nextStatus, nextBuckets] = await Promise.all([api.getAdminStatus(), api.getAdminBuckets('date')]);
      status = nextStatus;
      bucketData = nextBuckets;
      const pages = await Promise.all(
        nextBuckets.buckets.map(async (bucket: BucketRef) => {
          const page = await api.getBucket(bucket.key, { limit: 48 });
          return [bucket.key, page.items] as const;
        })
      );
      days = Object.fromEntries(pages);
    } catch (error) {
      console.error('timeline failed', error);
      notice = 'Could not load the timeline.';
    }
  }

  async function rescan() {
    if (busy) return;
    busy = true;
    try {
      await api.rescan();
      notice = 'Rescan requested.';
    } catch {
      notice = 'Could not start the rescan.';
    } finally {
      busy = false;
      window.setTimeout(() => (notice = ''), 4000);
    }
  }
</script>

<svelte:head>
  <title>Timeline · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <h1>Timeline</h1>
  <div role="group" aria-label="View mode" class="segmented">
    <a href="/s/admin" class="on" aria-current="page">Date</a>
    <a href="/s/admin/folders">Folder</a>
  </div>
  <label class="search">
    <Icon name="search" size={16} />
    <input type="search" aria-label="Search" placeholder="Search file name or date" bind:value={query} />
  </label>
  <button type="button" class="rescan" onclick={rescan} disabled={busy}>
    <Icon name="refresh" size={16} strokeWidth={2} />
    Rescan
  </button>
</header>

<div class="meta">
  <span class="count"><i aria-hidden="true"></i>{formatCount(status?.assets)} photos</span>
  <span>Thumbnails queued: {formatCount(status?.pendingThumbs)}</span>
  <span>Last scan: {status?.lastScanAt ? formatLocalClock(status.lastScanAt) : '—'}</span>
</div>

{#if notice}
  <p class="notice" role="status">{notice}</p>
{/if}

<div class="body">
  <div class="days">
    {#each visible as bucket (bucket.key)}
      <section id={`day-${bucket.key}`} class="day">
        <div class="day-head">
          <h2>{bucket.label ?? bucket.key}</h2>
          {#if bucket.sub}<span>{bucket.sub}</span>{/if}
        </div>
        {#if days[bucket.key]}
          <JustifiedGrid
            assets={days[bucket.key]}
            targetRowHeight={150}
            gap={4}
            theme="light"
            ariaLabel={bucket.label ?? bucket.key}
            onopen={(id) => (viewerId = id)}
          />
        {:else}
          <p class="loading-row" aria-busy="true">Loading…</p>
        {/if}
      </section>
    {:else}
      <p class="empty">No days match your search.</p>
    {/each}
  </div>

  {#if years.length}
    <nav aria-label="Jump to month" class="months">
      {#each years as group (group.year)}
        <span class="year">{group.year}</span>
        {#each group.months as month (month.key)}
          {@const target = bucketData?.buckets.find((bucket) => bucket.key.startsWith(month.key))}
          {#if target}
            <a href={`#day-${target.key}`} class:current={month.key === activeMonth}>{month.label}</a>
          {:else}
            <span class="month-missing">{month.label}</span>
          {/if}
        {/each}
      {/each}
    </nav>
  {/if}
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
    letter-spacing: -0.01em;
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

  .search {
    flex: 1 1 240px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border: 1px solid #d3dadc;
    border-radius: 6px;
    padding: 0 12px;
    height: 42px;
    color: #66737a;
  }

  .search input {
    border: 0;
    outline: 0;
    flex: 1;
    min-width: 0;
    font-size: 14px;
    background: transparent;
    color: var(--graphite);
  }

  .rescan {
    height: 42px;
    padding: 0 16px;
    border: 0;
    border-radius: 6px;
    background: var(--graphite);
    color: #fff;
    font-weight: 600;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rescan:disabled {
    opacity: 0.6;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    font-size: 13px;
    color: var(--steel);
  }

  .count {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count i {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--teal-ink);
  }

  .notice {
    margin: 0;
    padding: 8px 12px;
    background: var(--teal-soft);
    color: var(--teal-ink);
    border-radius: 6px;
    font-size: 14px;
  }

  .body {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }

  .days {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .day-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }

  .day-head h2 {
    font-size: 17px;
    font-weight: 600;
  }

  .day-head span {
    font-size: 13px;
    color: var(--steel);
  }

  .loading-row {
    color: var(--steel);
    font-size: 13px;
    padding: 12px 0;
  }

  .empty {
    color: var(--steel);
    font-size: 14px;
  }

  .months {
    flex: 0 0 64px;
    position: sticky;
    top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 12px;
    color: var(--steel);
    text-align: right;
  }

  .year {
    font-weight: 700;
    color: var(--graphite);
  }

  .months a {
    color: var(--steel);
  }

  .months a:hover {
    color: var(--graphite);
  }

  .months a.current {
    color: var(--teal-ink);
    font-weight: 600;
  }

  .month-missing {
    color: #aab4b7;
  }

  @media (max-width: 760px) {
    .months {
      display: none;
    }

    h1 {
      font-size: 26px;
    }
  }
</style>

{#if viewerId}
  <AdminViewer items={loadedItems} id={viewerId} onclose={() => (viewerId = null)} onchange={(id) => (viewerId = id)} />
{/if}
