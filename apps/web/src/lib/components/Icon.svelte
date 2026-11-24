<script lang="ts">
  type IconName =
    | 'grid'
    | 'albums'
    | 'link'
    | 'pulse'
    | 'search'
    | 'refresh'
    | 'share'
    | 'heart'
    | 'download'
    | 'more'
    | 'back'
    | 'close'
    | 'whatsapp'
    | 'copy'
    | 'trash'
    | 'globe'
    | 'check';

  let {
    name,
    size = 22,
    strokeWidth = 1.8,
    fill = 'none',
    label
  }: {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    fill?: string;
    label?: string;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={fill}
  stroke={fill === 'none' ? 'currentColor' : 'none'}
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : 'true'}
  aria-label={label}
  role={label ? 'img' : undefined}
>
  {#if name === 'grid'}
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  {:else if name === 'albums'}
    <path d="M3 7h18v13H3z" />
    <path d="M7 4h10" />
  {:else if name === 'link'}
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  {:else if name === 'pulse'}
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  {:else if name === 'refresh'}
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  {:else if name === 'share'}
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4" />
    <path d="m15.4 6.5-6.8 4" />
  {:else if name === 'heart'}
    <path d="M12 21s-7-4.4-9.3-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z" />
  {:else if name === 'download'}
    <path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4 4 0 0 1 0 9" />
    <path d="M12 11v9" />
    <path d="m9 17 3 3 3-3" />
  {:else if name === 'more'}
    <circle cx="12" cy="5" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.8" fill="currentColor" stroke="none" />
  {:else if name === 'back'}
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  {:else if name === 'close'}
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  {:else if name === 'whatsapp'}
    <path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z" />
  {:else if name === 'copy'}
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  {:else if name === 'trash'}
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  {:else if name === 'globe'}
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  {:else if name === 'check'}
    <path d="m5 12 4.5 4.5L19 7" />
  {/if}
</svg>
