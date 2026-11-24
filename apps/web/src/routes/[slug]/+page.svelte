<script lang="ts">
  import { page } from '$app/state';
  import { api, isNotFound } from '$lib/api/client';
  import type { AlbumResponse, ClientPortalResponse } from '@gallery/shared';
  import AlbumView from '$lib/components/AlbumView.svelte';
  import PortalView from '$lib/components/PortalView.svelte';
  import Logo from '$lib/components/Logo.svelte';

  let mode = $state<'loading' | 'client' | 'album' | 'missing' | 'error'>('loading');
  let client = $state<ClientPortalResponse | null>(null);
  let album = $state<AlbumResponse | null>(null);
  let message = $state('');

  const slug = $derived(page.params.slug ?? '');

  $effect(() => {
    const target = slug;
    if (target) void load(target);
  });

  async function load(target: string) {
    mode = 'loading';
    client = null;
    album = null;
    message = '';
    try {
      const resolved = await api.resolve(target);
      if (resolved.kind === 'client') {
        client = await api.getClient(target);
        mode = 'client';
      } else {
        album = await api.getAlbum(target, page.url.searchParams.get('cam'));
        mode = 'album';
      }
    } catch (cause) {
      console.error('resolve gagal', cause);
      if (isNotFound(cause)) {
        mode = 'missing';
      } else {
        mode = 'error';
        message = 'Tak dapat muatkan galeri. Semak sambungan dan cuba lagi.';
      }
    }
  }
</script>

{#if mode === 'client' && client}
  {#key client.client.slug}
    <PortalView data={client} />
  {/key}
{:else if mode === 'album' && album}
  {#key album.album.slug}
    <AlbumView data={album} />
  {/key}
{:else if mode === 'missing'}
  <div class="public-theme notfound">
    <div class="inner">
      <Logo width={104} />
      <div class="content">
        <div class="blocks" aria-hidden="true"><span></span><span></span><span></span></div>
        <h1>Link ni tak dijumpai</h1>
        <p>Semak ejaan link, atau minta link baru dari JohorStudio.</p>
        <a class="cta" href="https://johorstudio.com">Pergi ke johorstudio.com</a>
      </div>
    </div>
  </div>
{:else if mode === 'error'}
  <div class="public-theme state">
    <Logo width={104} />
    <p>{message}</p>
    <button type="button" class="retry" onclick={() => load(slug)}>Cuba lagi</button>
  </div>
{:else}
  <div class="public-theme state" aria-busy="true">
    <Logo width={104} />
    <p>Memuatkan galeri…</p>
  </div>
{/if}

<style>
  .notfound {
    min-height: 100vh;
    padding: 20px 24px 24px;
  }

  .inner {
    max-width: 420px;
    margin: 0 auto;
    min-height: calc(100vh - 44px);
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
  }

  .blocks {
    display: grid;
    grid-template-columns: repeat(3, 56px);
    gap: 4px;
  }

  .blocks span {
    height: 56px;
    background: var(--surface);
  }

  .blocks span:nth-child(2) {
    background: #2f383d;
  }

  h1 {
    font-size: 34px;
    font-weight: 700;
    font-stretch: 80%;
    line-height: 1.05;
    color: #fff;
  }

  p {
    font-size: 16px;
    line-height: 1.5;
    color: var(--muted);
  }

  .cta {
    align-self: flex-start;
    height: 48px;
    padding: 0 20px;
    border-radius: 24px;
    background: var(--teal);
    color: #10201e;
    font-size: 15px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
  }

  .state {
    min-height: 100vh;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
    justify-content: center;
  }

  .state p {
    margin: 0;
  }

  .retry {
    height: 44px;
    padding: 0 18px;
    border: 1px solid var(--line-hard);
    border-radius: 22px;
    background: transparent;
    color: var(--text);
  }

  @media (min-width: 760px) {
    .notfound {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .inner {
      width: 100%;
      min-height: auto;
      border: 1px solid var(--line-dark);
      border-radius: 12px;
      padding: 32px;
      background: #151a1c;
    }
  }
</style>
