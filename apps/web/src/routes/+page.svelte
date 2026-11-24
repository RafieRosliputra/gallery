<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { loginGate, safeNext } from '$lib/routing/guards';
  import Logo from '$lib/components/Logo.svelte';

  let username = $state('rafi');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let checking = $state(true);

  const next = $derived(safeNext(page.url.searchParams.get('next')));

  onMount(async () => {
    try {
      await api.getAdminStatus();
      if (loginGate('yes') === 'admin') await goto(next, { replaceState: true });
    } catch {
      // 401 is the expected state; network errors also leave the form usable.
    } finally {
      checking = false;
    }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      await api.login(username, password);
      await goto(next, { replaceState: true });
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'Tak dapat hubungi pelayan. Cuba lagi.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Log masuk admin · JohorStudio</title>
</svelte:head>

<div class="login">
  <section class="intro" aria-label="JohorStudio">
    <Logo width={200} />
    <div class="swatches" aria-hidden="true">
      {#each ['#6f7b80', '#a99c8f', '#8f9aa0', '#b7c4bf', '#c9bfb4', '#7d8a8f', '#9fb0a8', '#b9aea2'] as color (color)}
        <span style:background={color}></span>
      {/each}
    </div>
    <p class="tagline">Galeri studio.<br />Semua gambar, satu tempat.</p>
  </section>

  <section class="form-side">
    <form onsubmit={submit} novalidate>
      <div class="heading">
        <h1>Log masuk admin</h1>
        <p>johorstudio.com/s</p>
      </div>

      <label>
        Nama pengguna
        <input
          type="text"
          name="username"
          autocomplete="username"
          bind:value={username}
          disabled={busy || checking}
        />
      </label>

      <label>
        Kata laluan
        <input
          type="password"
          name="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={busy || checking}
        />
      </label>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <button type="submit" class="submit" disabled={busy || checking}>
        {busy ? 'Memasuk…' : 'Masuk'}
      </button>
      <p class="hint">5 cubaan salah = kunci 15 minit.</p>
    </form>
  </section>
</div>

<style>
  .login {
    min-height: 100vh;
    display: flex;
    flex-wrap: wrap;
    font-family: inherit;
    color: var(--graphite);
    background: var(--graphite);
  }

  .intro {
    flex: 1 1 420px;
    min-height: 280px;
    padding: 56px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 32px;
    color: #fff;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    max-width: 560px;
    width: 100%;
  }

  .swatches span {
    height: 120px;
    border-radius: 2px;
  }

  .tagline {
    font-size: 40px;
    font-weight: 700;
    font-stretch: 80%;
    line-height: 1.05;
    max-width: 520px;
  }

  .form-side {
    flex: 1 1 420px;
    background: var(--paper);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
  }

  form {
    width: 100%;
    max-width: 380px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .heading {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h1 {
    font-size: 30px;
    font-weight: 700;
    font-stretch: 85%;
    line-height: 1.1;
  }

  .heading p {
    font-size: 15px;
    color: var(--steel);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
  }

  input {
    height: 46px;
    border: 1px solid #c4ccce;
    border-radius: 6px;
    padding: 0 14px;
    font-weight: 400;
    font-size: 15px;
    background: #fff;
    color: var(--graphite);
  }

  input:disabled {
    opacity: 0.65;
  }

  .submit {
    height: 48px;
    border: 0;
    border-radius: 6px;
    background: var(--teal-ink);
    color: #fff;
    font-weight: 600;
    font-size: 16px;
  }

  .submit:hover:not(:disabled) {
    background: #185b55;
  }

  .submit:disabled {
    opacity: 0.7;
  }

  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: 6px;
    background: #f8e3e1;
    color: #8a2a24;
    font-size: 14px;
  }

  .hint {
    font-size: 13px;
    color: var(--steel);
  }

  @media (max-width: 560px) {
    .intro {
      padding: 28px 20px;
      min-height: 220px;
    }

    .swatches span {
      height: 64px;
    }

    .tagline {
      font-size: 30px;
    }

    .form-side {
      padding: 32px 20px 48px;
    }
  }
</style>
