<script lang="ts">
  import { base } from '$app/paths';

  // Floating "WhatsApp Rafi" button, bottom-right on every public page.
  const PHONE = '60127983745';
  const MESSAGE = 'Hi Rafi';
  const href = `https://wa.me/${PHONE}?text=${encodeURIComponent(MESSAGE)}`;
</script>

<a class="wa" {href} target="_blank" rel="noopener" aria-label="WhatsApp Rafi">
  <img src={`${base}/wa-rafi.webp`} alt="" width="240" height="306" />
  <span>WhatsApp Rafi</span>
</a>

<style>
  .wa {
    position: fixed;
    right: calc(16px + env(safe-area-inset-right));
    bottom: calc(16px + env(safe-area-inset-bottom));
    z-index: 70;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    filter: drop-shadow(0 6px 14px rgb(0 0 0 / 0.35));
    transition: transform 150ms ease-out;
  }
  .wa:hover {
    transform: translateY(-2px);
  }
  img {
    width: 96px;
    height: auto;
    display: block;
  }
  span {
    padding: 6px 12px;
    border-radius: 999px;
    background: #1fa855;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }
  @media (max-width: 600px) {
    .wa {
      right: calc(10px + env(safe-area-inset-right));
      bottom: calc(12px + env(safe-area-inset-bottom));
      gap: 4px;
    }
    img {
      width: 70px;
    }
    span {
      padding: 4px 9px;
      font-size: 11px;
    }
  }
</style>
