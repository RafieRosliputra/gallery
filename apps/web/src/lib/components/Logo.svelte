<script lang="ts">
  import { base } from '$app/paths';

  let { width = 120, class: klass = '', alt = 'JohorStudio.com' }: {
    width?: number;
    class?: string;
    alt?: string;
  } = $props();
</script>

<img
  src={`${base}/logo-light.png`}
  {alt}
  width="800"
  height="280"
  class="logo {klass}"
  style:width={`${width}px`}
  style:height="auto"
/>
