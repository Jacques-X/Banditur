<script>
  // Posts (post maker): the module in src/postmaker/ draws its own UI into `root`.
  import { handoffPost } from '../lib/handoff.svelte.js';
  import { projects } from '../lib/projects.svelte.js';
  import { onMount } from 'svelte';
  import { createPostMaker } from '../postmaker/index.js';
  import { invoke, saveDialog, openDialog, fileSrc } from '../lib/tauri.js';
  import { toast, confirm, go, logJob, app } from '../lib/app.svelte.js';
  import { post, addMedia, changed, saveDraft, reset } from './skeda/composer.svelte.js';
  import { PM } from '../strings.js';

  let { active } = $props();
  let root;
  let maker = $state.raw(null);

  onMount(() => {
    maker = createPostMaker({
      root, invoke, saveDialog, openDialog, fileSrc,
      toast: (m, t) => { if (t === 'ok' && /^Issejvjat:/.test(m)) logJob({ tool: 'Posts', name: m.replace(/^Issejvjat:\s*/, ''), status: 'Exported', tone: 'ok' }); toast(m, t); },
      confirm: (m, o) => confirm(m, o),
      S: PM,
      async sendToComposer(file,caption,eventId) {
        if(post.caption.trim() || post.media.length || post.remoteMedia.length) {if(!await confirm('Iżżomm il-post attwali bħala draft?',{yes:'Żomm u kompli',no:'Ibqa’ hawn'})) return false;await saveDraft();}
        reset();post.caption=caption || '';post.eventId=eventId || '';
        if (post.contentType !== 'post') { post.contentType = 'post'; changed(); }
        addMedia([file]);
        logJob({ tool: 'Posts', name: file.name, status: 'Intuża f\'post ġdid', tone: 'ok' });
        go('skeda');
      },
    });
  });
  $effect(() => {app.profileId;if (active && maker) maker.show(); });
  $effect(()=>{if(handoffPost.id && maker){const id=handoffPost.id;handoffPost.id='';const p=projects.items.find(p=>p.id===id);if(p) maker.show().then(()=>maker.workflows.open(p)).catch(e=>toast(e.message,'error'));}});
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
