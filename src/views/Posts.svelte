<script>
  // Posts (post maker): the module in src/postmaker/ draws its own UI into `root`.
  import { onMount } from 'svelte';
  import { createPostMaker } from '../postmaker/index.js';
  import { invoke, saveDialog, openDialog, fileSrc } from '../lib/tauri.js';
  import { toast, confirm, go, logJob } from '../lib/app.svelte.js';
  import { post, addMedia, changed } from './skeda/composer.svelte.js';
  import { PM } from '../strings.js';

  let { active } = $props();
  let root;
  let maker = null;

  onMount(() => {
    maker = createPostMaker({
      root, invoke, saveDialog, openDialog, fileSrc,
      toast: (m, t) => { if (t === 'ok' && /^Issejvjat:/.test(m)) logJob({ tool: 'Posts', name: m.replace(/^Issejvjat:\s*/, ''), status: 'Esportat', tone: 'ok' }); toast(m, t); },
      confirm: (m, o) => confirm(m, o),
      S: PM,
      sendToComposer(file) {
        if (post.contentType !== 'post') { post.contentType = 'post'; changed(); }
        addMedia([file]);
        logJob({ tool: 'Posts', name: file.name, status: 'Intuża f\'post ġdid', tone: 'ok' });
        go('skeda');
      },
    });
  });
  $effect(() => { if (active && maker) maker.show(); });
</script>

<div class="posts">
  <div class="head"><h1>Posts</h1><span class="muted">Awguri, kondoljanzi u posts oħra li jirrepetu: template + ritratt + isem.</span></div>
  <div class="pm-host" bind:this={root}></div>
</div>

<style>
  .posts { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .head { display: flex; align-items: baseline; gap: 14px; padding: 18px 24px 8px; }
  .pm-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
