<script lang="ts">
  // Admin-written text shown on public pages. Plain text only (never HTML);
  // web addresses and bare domains such as johorstudio.com become links.
  let { text = '', class: className = '' }: { text?: string; class?: string } = $props();

  const LINK = /(https?:\/\/[^\s<]+[^\s<.,;:!?)]|(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|my|net|org|co|io|app|store|com\.my)(?:\/[^\s<]*[^\s<.,;:!?)])?)/gi;

  interface Part {
    text: string;
    href?: string;
  }

  const parts = $derived.by<Part[]>(() => {
    const out: Part[] = [];
    let last = 0;
    for (const match of text.matchAll(LINK)) {
      const start = match.index ?? 0;
      if (start > last) out.push({ text: text.slice(last, start) });
      const value = match[0];
      out.push({ text: value, href: /^https?:\/\//i.test(value) ? value : `https://${value}` });
      last = start + value.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  });
</script>

{#if text.trim()}
  <p class="rich {className}">
    {#each parts as part, index (index)}{#if part.href}<a href={part.href} target="_blank" rel="noopener">{part.text}</a>{:else}{part.text}{/if}{/each}
  </p>
{/if}

<style>
  .rich {
    margin: 0;
    white-space: pre-line;
    font-size: 15px;
    line-height: 1.5;
    color: #c3ccce;
    max-width: 70ch;
  }
  .rich a {
    color: var(--teal);
    font-weight: 600;
  }
</style>
