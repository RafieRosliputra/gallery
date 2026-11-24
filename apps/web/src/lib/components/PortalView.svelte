<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { AlbumCard, ClientPortalResponse } from '@gallery/shared';
  import { formatCount, formatShortDate } from '$lib/format';
  import { markOpenedFromClient } from '$lib/routing/back';
  import Icon from '$lib/components/Icon.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import Photo from '$lib/components/Photo.svelte';
  import ShareSheet from '$lib/components/ShareSheet.svelte';

  let { data }: { data: ClientPortalResponse } = $props();

  let menuOpen = $state(false);
  let sharing = $state<AlbumCard | null>(null);

  const menu = [{ label: 'Pergi ke JohorStudio.com', icon: 'globe' as const, href: 'https://johorstudio.com' }];

  function openAlbum(album: AlbumCard) {
    markOpenedFromClient(album.slug, data.client.slug);
    void goto(`${base}/${album.slug}`);
  }

  async function shareAlbum(album: AlbumCard) {
    const url = `${window.location.origin}${base}/${album.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: album.title, url });
        return;
      } catch {
        return;
      }
    }
    sharing = album;
  }
</script>

<svelte:head>
  <title>{data.client.name} · JohorStudio</title>
</svelte:head>

<div class="public-theme portal">
  <header class="top">
    <div class="top-inner">
      <a href="https://johorstudio.com" aria-label="JohorStudio.com" class="logo-desktop"><Logo width={120} /></a>
      <a href="https://johorstudio.com" aria-label="JohorStudio.com" class="logo-mobile"><Logo width={92} /></a>
      <div class="menu-wrap">
        <button
          type="button"
          class="icon"
          aria-label="Lagi"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <Icon name="more" size={22} />
        </button>
        <MoreMenu open={menuOpen} onclose={() => (menuOpen = false)} items={menu} />
      </div>
    </div>
  </header>

  <main class="main">
    <div class="intro">
      <span class="eyebrow">GALERI KLIEN</span>
      <h1>{data.client.name}</h1>
      <span class="meta">{formatCount(data.albumCount)} album · {formatCount(data.assetCount)} gambar</span>
    </div>

    <div class="grid">
      {#each data.albums as album (album.id)}
        {@const first = album.covers?.[0]}
        <div class="card">
          <a
            class="collage"
            href={`${base}/${album.slug}`}
            aria-label={`Buka album ${album.title}`}
            onclick={(event) => {
              event.preventDefault();
              openAlbum(album);
            }}
          >
            <span class="main-cover">{#if first}<Photo asset={first} />{/if}</span>
            <span class="side">
              {#each [1, 2] as slot (slot)}
                {@const cover = album.covers?.[slot]}
                <span class="side-cover">{#if cover}<Photo asset={cover} />{/if}</span>
              {/each}
            </span>
          </a>
          <button type="button" class="share" aria-label={`Kongsi album ${album.title}`} onclick={() => shareAlbum(album)}>
            <Icon name="share" size={20} />
          </button>
          <div class="card-text">
            <a
              href={`${base}/${album.slug}`}
              onclick={(event) => {
                event.preventDefault();
                openAlbum(album);
              }}>{album.title}</a
            >
            <span class="album-meta">{#if album.takenAt}<span class="date">{formatShortDate(album.takenAt)} · </span>{/if}{formatCount(album.assetCount)} gambar{#if album.cameras.length > 1} · {album.cameras.length} kamera{/if}</span>
          </div>
        </div>
      {/each}
    </div>
  </main>

  <footer>Gambar oleh <a href="https://johorstudio.com">JohorStudio.com</a></footer>

  {#if sharing}
    <ShareSheet album={sharing} onclose={() => (sharing = null)} />
  {/if}
</div>

<style>
  .portal {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .top {
    background: var(--bar);
    position: relative;
  }

  .top-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .logo-mobile {
    display: none;
  }

  .menu-wrap {
    position: relative;
  }

  .icon {
    width: 48px;
    height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 24px;
    background: transparent;
    color: #d7dddf;
  }

  .icon:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .main {
    flex: 1;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 36px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .eyebrow {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  h1 {
    font-size: 48px;
    font-weight: 700;
    font-stretch: 78%;
    line-height: 1;
    color: #fff;
  }

  .meta {
    font-size: 15px;
    color: var(--muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .collage {
    display: flex;
    gap: 3px;
    height: 210px;
    border-radius: 8px;
    overflow: hidden;
  }

  .main-cover {
    position: relative;
    flex: 3 1 0;
    background: #5d5650;
  }

  .side {
    flex: 2 1 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .side-cover {
    position: relative;
    flex: 1;
    background: #4a5257;
    overflow: hidden;
  }

  .share {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 22px;
    background: rgb(18 21 23 / 0.75);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .share:hover {
    background: rgb(18 21 23 / 0.9);
  }

  .card-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .card-text a {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  .card-text .album-meta {
    font-size: 14px;
    color: var(--muted);
  }

  footer {
    border-top: 1px solid var(--line-dark);
    padding: 20px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .top-inner {
      padding: 8px 6px 8px 14px;
    }

    .eyebrow {
      font-size: 12px;
    }

    .logo-desktop {
      display: none;
    }

    .logo-mobile {
      display: block;
    }

    .main {
      padding: 20px 14px 40px;
      gap: 18px;
    }

    h1 {
      font-size: 34px;
    }

    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 10px;
    }

    .collage {
      height: 170px;
    }

    .side {
      display: none;
    }

    .main-cover {
      flex: 1;
    }

    .card-text a {
      font-size: 15px;
    }

    .card-text .album-meta {
      font-size: 13px;
    }

    .card-text .date {
      display: none;
    }

    footer {
      display: none;
    }
  }
</style>
