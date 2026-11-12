<script>
  // Posts (post maker): the screens are in posts/ (PostMaker, TemplateEditor, WorkPanel); the logic in postmaker/.
  import { handoffPost } from '../lib/handoff.svelte.js';
  import { projects } from '../lib/projects.svelte.js';
  import { toast, go, logJob, app } from '../lib/app.svelte.js';
  import { addMedia, replaceWith } from './skeda/composer.svelte.js';
  import PostMaker from './posts/PostMaker.svelte';

  let { active } = $props();
  let maker = $state();

  function ontoast(m, t) {
    if (t === 'ok' && /^Issejvjat:/.test(m)) logJob({ tool: 'Posts', name: m.replace(/^Issejvjat:\s*/, ''), status: 'Exported', tone: 'ok' });
    toast(m, t);
  }

  async function sendToComposer(file, caption, eventId) {
    const done = await replaceWith((p) => {
      p.caption = caption || '';
      p.eventId = eventId || '';
      addMedia([file]);
    });
    if (!done) return false;
    logJob({ tool: 'Posts', name: file.name, status: 'Intuża f\'post ġdid', tone: 'ok' });
    go('skeda');
  }

  $effect(() => { app.profileId; if (active && maker) maker.show(); });
  $effect(() => {
    if (!handoffPost.id || !maker) return;
    const id = handoffPost.id;
    handoffPost.id = '';
    const p = projects.items.find(p => p.id === id);
    if (p) maker.show().then(() => maker.open(p)).catch(e => toast(e.message, 'error'));
  });
</script>

<div class="posts">
  <div class="head"><h1>Posts</h1><span class="muted">Awguri, kondoljanzi u posts oħra li jirrepetu: template + ritratt + isem.</span></div>
  <div class="pm-host"><PostMaker bind:this={maker} {sendToComposer} {ontoast} /></div>
</div>

<style>
  .posts { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .head { display: flex; align-items: baseline; gap: 14px; padding: 18px 24px 8px; }
  .pm-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
