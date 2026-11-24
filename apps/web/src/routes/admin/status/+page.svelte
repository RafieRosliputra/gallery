<script lang="ts">
  import { onMount } from 'svelte';
  import type { AdminStatusView } from '$lib/api/models';
  import { api } from '$lib/api/client';
  import { formatBytes, formatClock, formatCount } from '$lib/format';

  let status = $state<AdminStatusView | null>(null);
  let error = $state('');

  onMount(async () => {
    try {
      status = await api.getAdminStatus();
    } catch (cause) {
      console.error('status gagal', cause);
      error = 'Status sistem tak dapat dimuatkan.';
    }
  });

  const logEntries = $derived.by(() => {
    if (status?.log?.length) return status.log;
    if (!status) return [];
    return [
      {
        at: status.lastScanAt ? formatClock(status.lastScanAt) : '—',
        message: 'Imbas terakhir selesai'
      },
      {
        at: '—',
        message: `${formatCount(status.pendingThumbs)} thumbnail dalam giliran`
      },
      {
        at: '—',
        message: `${formatCount(status.errors24h)} ralat dalam 24 jam`
      }
    ];
  });

  interface Card {
    title: string;
    big: string;
    pct: number;
    note: string;
    tone: 'ok' | 'run' | 'warn' | 'off';
    tag: string;
  }

  const cards = $derived.by<Card[]>(() => {
    if (!status) return [];
    const done = status.thumbsDone ?? status.assets - status.pendingThumbs;
    const r2done = status.r2Done ?? status.assets - status.pendingR2;
    const thumbPct = status.assets > 0 ? Math.round((done / status.assets) * 100) : 0;
    const r2Pct = status.assets > 0 ? Math.round((r2done / status.assets) * 100) : 0;
    const hot = status.hotCache;
    const ram = status.ram;
    return [
      {
        title: 'Pengimbas folder',
        big: formatCount(status.assets),
        pct: 100,
        note: 'Watch fail baru aktif · imbas penuh malam 03:00',
        tone: 'ok',
        tag: 'OK'
      },
      {
        title: 'Jana thumbnail',
        big: `${formatCount(status.pendingThumbs)} lagi`,
        pct: thumbPct,
        note: 'Grid 300px + preview 1600px WebP · ~0.4 s/gambar',
        tone: 'run',
        tag: 'Berjalan'
      },
      status.r2Enabled
        ? {
            title: 'Push ke R2',
            big: formatCount(r2done),
            pct: r2Pct,
            note: 'cdn.johorstudio.com · 0 gagal',
            tone: 'ok' as const,
            tag: 'OK'
          }
        : {
            title: 'Push ke R2',
            big: '—',
            pct: 0,
            note: 'R2 dimatikan (R2_MODE=off)',
            tone: 'off' as const,
            tag: 'Tutup'
          },
      {
        title: 'Hot cache SSD',
        big: hot ? `${Math.round(hot.usedBytes / 1024 ** 3)} / ${Math.round(hot.capBytes / 1024 ** 3)} GB` : '—',
        pct: hot && hot.capBytes > 0 ? Math.round((hot.usedBytes / hot.capBytes) * 100) : 0,
        note: 'Simpan 30 hari · 1,940 fail tamat minggu ni',
        tone: 'ok',
        tag: 'OK'
      },
      {
        title: 'RAM tnas',
        big: ram ? `${formatBytes(ram.freeBytes, 1)} kosong` : '—',
        pct: ram && ram.totalBytes > 0 ? Math.round(((ram.totalBytes - ram.freeBytes) / ram.totalBytes) * 100) : 0,
        note: 'Postgres + app + thumbnail berkongsi 11 GB',
        tone: 'warn',
        tag: 'Perhati'
      },
      {
        title: 'Proses muka',
        big: status.faceSearch ? 'Aktif' : 'Belum aktif',
        pct: 0,
        note: 'CPU tnas · malam sahaja · album klien sahaja',
        tone: 'off',
        tag: 'Fasa 4'
      }
    ];
  });
</script>

<svelte:head>
  <title>Status sistem · JohorStudio admin</title>
</svelte:head>

<header class="head">
  <h1>Status sistem</h1>
  <span>tnas · dikemas kini {status?.updatedAt ? formatClock(status.updatedAt) : '—'}</span>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="grid">
  {#each cards as card (card.title)}
    <section class="card">
      <div class="card-head">
        <h2>{card.title}</h2>
        <span class="tag {card.tone}">{card.tag}</span>
      </div>
      <span class="big">{card.big}</span>
      <div class="bar"><div class="fill {card.tone}" style:width={`${card.pct}%`}></div></div>
      <span class="note">{card.note}</span>
    </section>
  {/each}
</div>

<section class="log">
  <h2>Log terkini</h2>
  {#each logEntries as entry, index (index)}
    <div class="log-row"><span class="time">{entry.at}</span><span>{entry.message}</span></div>
  {:else}
    <p class="note">Tiada log.</p>
  {/each}
</section>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  h1 {
    font-size: 30px;
    font-weight: 700;
    font-stretch: 85%;
  }

  .head span {
    font-size: 14px;
    color: var(--steel);
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
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }

  .card {
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .card-head h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .tag {
    font-size: 12px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .tag.ok {
    color: var(--teal-ink);
    background: var(--teal-soft);
  }

  .tag.run {
    color: var(--graphite);
    background: var(--mist);
  }

  .tag.warn {
    color: #8a2a24;
    background: #f8e3e1;
  }

  .tag.off {
    color: var(--steel);
    background: #eef1f1;
  }

  .big {
    font-size: 28px;
    font-weight: 700;
    font-stretch: 85%;
  }

  .bar {
    height: 8px;
    background: var(--mist);
    border-radius: 4px;
    overflow: hidden;
  }

  .fill {
    height: 8px;
    border-radius: 4px;
    background: var(--teal-ink);
  }

  .fill.run {
    background: #66737a;
  }

  .fill.warn {
    background: #d6453d;
  }

  .fill.off {
    background: #c4ccce;
  }

  .note {
    font-size: 13px;
    color: var(--steel);
  }

  .log {
    background: #fff;
    border: 1px solid var(--mist);
    border-radius: 6px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .log h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .log-row {
    display: flex;
    gap: 16px;
    font-size: 14px;
    padding: 6px 0;
    border-top: 1px solid #eef1f1;
  }

  .time {
    flex: 0 0 52px;
    color: var(--steel);
  }
</style>
