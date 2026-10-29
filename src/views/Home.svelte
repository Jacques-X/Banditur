<script>
  import { projects, eventWork, useEvent } from '../lib/projects.svelte.js';
  import { studioJobs } from '../lib/studio-jobs.svelte.js';
  import { handoffPost } from '../lib/handoff.svelte.js';
  import { api } from '../lib/api.js';
  import { openQueued, post, saveDraft, reset, changed } from './skeda/composer.svelte.js';
  import Icon from '../components/Icon.svelte';
  import { app, go, openTool, openSettings, TOOLS, jobs, clearJobs, confirm, profileName } from '../lib/app.svelte.js';
  import { queue, statusOf } from '../lib/queue.svelte.js';
  import { shortDateTime, longDate } from '../lib/format.js';
  import { openPath } from '../lib/tauri.js';
  import { listRecentSessions } from '../subtitles/editor.js';
  import { ago } from '../lib/format.js';
  import { handoffTx } from './traskrittura/handoff.svelte.js';

  // Transcription sessions come from the editor's own autosave; the rest from logJob().
  const items = $derived.by(() => {
    jobs.length;
    const tx = listRecentSessions(6).map(s => ({ tool: 'Traskrittura', name: s.name, status: `${s.cues} subtitles · editjat`, tone: 'warn', at: s.savedAt, resume: s.path }));
    return [...tx, ...jobs].sort((a, b) => b.at - a.at).slice(0, 12);
  });

  let eventPosts=$state([]),eventError=$state('');
  const overdue=$derived(queue.upcoming.filter(p=>Date.parse(p.scheduled_time)<Date.now()-5*60000));
  const unfinished=$derived(projects.items.filter(p=>p.kind!=='event' && p.status!=='exported' && (!p.data?.profileId || p.data.profileId===app.profileId)));
  $effect(()=>{if(app.view!=='home' || !eventWork.id)return;const id=eventWork.id,profileId=app.profileId;api('/api/history',{query:{event_id:id,profile_id:profileId,limit:100}}).then(r=>{if(eventWork.id===id){eventPosts=r.posts || [];eventError='';}}).catch(e=>{eventError=e.message;});});
  async function createEventPost(){try{if(post.caption.trim() || post.media.length || post.remoteMedia.length)await saveDraft();reset();post.eventId=eventWork.id;changed();go('skeda');}catch(e){eventError=e.message;}}
  function resumeProject(p) {if(p.kind==='subtitles'){handoffTx.open=p.mediaPath;openTool('traskrittura');}else{handoffPost.id=p.id;openTool('posts');}}
  const hello = () => { const h = new Date().getHours(); return h < 18 ? 'Bonġu' : 'Bonswa'; };
  const next = $derived(queue.upcoming[0]);
  const SOCIAL = $derived([
    { id: 'skeda', label: 'Skeda', icon: 'pen', key: '1', desc: next ? `Jmiss: ${shortDateTime(new Date(next.scheduled_time))} · ${statusOf(next).label}` : 'Ikteb u skeda post ġdid' },
    { id: 'kalendarju', label: 'Kalendarju', icon: 'calendar', key: '2', desc: 'L-avvenimenti u l-posts fuq kalendarju' },
    { id: 'arkivju', label: 'L-Arkivju', icon: 'inbox', key: '3', desc: app.failed ? `${app.failed} fallew — ħares lejhom` : `${app.pending} pending · l-posts kollha` },
    { id: 'rapporti', label: 'Rapporti', icon: 'chart', key: '4', desc: 'Rapport tal-PR b\'numri u PDF' },
  ]);
</script>

<div class="studio scroll">
  <div>
    <h1>{hello()}</h1>
    <p class="muted lead">{longDate(new Date())} · {profileName()}</p>
  </div>

  <section class="recent" aria-label="Jeħtieġ attenzjoni">
    <div class="rh"><h2>Jeħtieġ attenzjoni</h2></div>
    {#if queue.error}<div class="notice danger">{queue.error}<button class="link" onclick={()=>openSettings('sistema')}>Iċċekkja l-konnessjoni</button></div>{/if}
    {#if app.failed}<div class="notice danger">{app.failed} posts għandhom destinazzjonijiet li fallew jew iridu verifika.<button class="link" onclick={()=>go('arkivju')}>Ara d-dettalji</button></div>{/if}
    {#each overdue as p}<button class="btn" onclick={()=>go('arkivju')}>Post li għadda l-ħin tiegħu · {shortDateTime(p.scheduled_time)} · {(p.caption || '').slice(0,80)}</button>{/each}
    {#each studioJobs.filter(j=>['failed','interrupted'].includes(j.state)).slice(0,4) as j}<button class="btn" onclick={()=>openTool(j.kind==='raw'?'raw':j.kind==='marka'?'marka':j.kind==='youtube'?'youtube':'traskrittura')}>{j.name} · {j.state==='failed'?'Falla':'Ġie interrott'} · Iftaħ biex tkompli</button>{/each}
    {#if projects.error}<div class="notice danger">Ma setax jinżamm il-proġett: {projects.error}</div>{/if}
    {#each unfinished.slice(0,4) as p}<button class="btn" onclick={()=>resumeProject(p)}>Kompli · {p.kind==='subtitles'?'Traskrittura':'Posts'} · {p.name}</button>{/each}
    {#if !app.failed && !overdue.length && !queue.error && !projects.error && !unfinished.length && !studioJobs.some(j=>['failed','interrupted'].includes(j.state))}<p class="muted">M’hemmx xogħol li jeħtieġ attenzjoni.</p>{/if}
  </section>

  {#if studioJobs.some(j=>['running','queued'].includes(j.state))}
  <section class="recent" aria-label="Xogħol għaddej"><div class="rh"><h2>Xogħol għaddej</h2></div>
    {#each studioJobs.filter(j=>['running','queued'].includes(j.state)) as j}<button class="btn" onclick={()=>openTool(j.kind==='raw'?'raw':j.kind==='marka'?'marka':j.kind==='youtube'?'youtube':'traskrittura')}>{j.name} · {j.state==='running'?'Għaddej':'Fil-kju'}</button>{/each}
  </section>{/if}
  <section class="recent" aria-label="Xogħol tal-avveniment">
    <div class="rh"><h2>Xogħol tal-avveniment</h2><select class="input" aria-label="Agħżel avveniment" value={eventWork.id} onchange={e=>{const p=projects.items.find(p=>p.eventId===e.currentTarget.value && p.kind==='event');useEvent(p?.eventId,p?.name);}}><option value="">Agħżel mill-kalendarju…</option>{#each projects.items.filter(p=>p.kind==='event') as p}<option value={p.eventId}>{p.name}</option>{/each}</select><button class="link" onclick={()=>go('kalendarju')}>Kalendarju</button></div>
    {#if eventWork.id}
      <p class="muted small">{eventWork.name} · Il-proġetti u l-posts ġodda jintrabtu ma’ dan l-avveniment.</p>
      {#each projects.items.filter(p=>p.kind!=='event' && p.eventId===eventWork.id) as p}<button class="btn" onclick={()=>resumeProject(p)}>{p.name} · {p.kind==='post'?'Disinn':'Subtitles'}</button>{/each}
      {#each studioJobs.filter(j=>j.eventId===eventWork.id && j.path) as j}<button class="btn" onclick={()=>openPath(j.path)}>{j.name} · Iftaħ il-media</button>{/each}
      {#if eventError}<div class="notice danger">{eventError}</div>{/if}
      {#each eventPosts as p}<button class="btn" onclick={async()=>{if(await openQueued(p,!['pending','fb_native'].includes(p.status))) go('skeda');}}>{statusOf(p).label} · {(p.caption || '').slice(0,100)}</button>{/each}
      <button class="btn primary" onclick={createEventPost}>Post ġdid għal dan l-avveniment</button>
    {/if}
  </section>

  <section aria-label="Social" class="grp">
    <div class="rh"><h2>Social</h2><span class="muted small">Skeda, kalendarju, arkivju u rapporti</span></div>
    <div class="tools four">
      {#each SOCIAL as t (t.id)}
        <button class="tool card" type="button" onclick={() => go(t.id)}>
          <Icon name={t.icon} size={22} />
          <strong>{t.label}</strong>
          <span class="small desc" class:bad={t.id === 'arkivju' && app.failed}>{t.desc}</span>
          <kbd>{t.key}</kbd>
        </button>
      {/each}
    </div>
  </section>

  <section aria-label="Studio" class="grp">
    <div class="rh"><h2>Studio</h2><span class="muted small">Għodda li jaħdmu fuq dan il-Mac — ir-ritratti u l-videos ma jitilgħu mkien.</span></div>
  <div class="tools">
    {#each TOOLS as t (t.id)}
      <button class="tool card" type="button" onclick={() => openTool(t.id)}>
        <Icon name={t.icon} size={22} />
        <strong>{t.label}</strong>
        <span class="muted small desc">{t.desc}</span>
        <kbd>⌘{t.key}</kbd>
      </button>
    {/each}
  </div>
  </section>

  <section aria-label="Xogħol riċenti" class="recent">
    <div class="rh"><h2>Xogħol riċenti</h2><span class="muted small">Kompli minn fejn ħallejt, jew iftaħ il-folder</span><span class="spacer"></span>
      {#if jobs.length}<button class="link small" type="button" onclick={async () => { if (await confirm('Tneħħi l-lista tax-xogħol riċenti? Il-files ma jintmessux.', { yes: 'Neħħi', no: 'Żomm' })) clearJobs(); }}>Naddaf il-lista</button>{/if}
    </div>
    {#if items.length}
      <div class="table card">
        {#each items as j, i (i)}
          <div class="jr">
            <span class="muted">{j.tool}</span>
            <span class="truncate name">{j.name}</span>
            <span class="small st {j.tone}">{j.status}</span>
            <span class="mono muted">{ago(j.at)}</span>
            {#if j.resume}<button class="link" type="button" onclick={() => { handoffTx.open = j.resume; openTool('traskrittura'); }}>Kompli</button>
            {:else if j.path}<button class="link" type="button" onclick={() => openPath(j.path)}>Iftaħ</button>
            {:else}<span></span>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="card empty"><strong>Għad m'hemm xejn hawn.</strong>Meta tuża xi għodda, ix-xogħol jidher hawn biex tkompli jew issib il-files.</div>
    {/if}
  </section>
</div>

<style>
  .studio { flex: 1; padding: 36px max(40px, calc((100% - 1200px) / 2)); display: flex; flex-direction: column; gap: 28px; }
  .lead { margin-top: 4px; }
  .grp { display: flex; flex-direction: column; gap: 10px; }
  .tools.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .desc { color: var(--muted); }
  .desc.bad { color: var(--danger-fg); font-weight: 600; }
  .tools { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
  .tool { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 16px; text-align: left; color: var(--fg); line-height: 1.4; }
  .tool:hover { border-color: var(--accent); }
  .tool :global(svg) { color: var(--accent-fg); }
  .tool kbd { position: absolute; top: 14px; right: 14px; }
  .recent { display: flex; flex-direction: column; gap: 10px; }
  .rh { display: flex; align-items: baseline; gap: 10px; }
  .table { overflow: hidden; }
  .jr { display: grid; grid-template-columns: 120px minmax(0, 1fr) 260px 110px 90px; gap: 16px; align-items: center; padding: 11px 16px; border-bottom: 1px solid var(--line-soft); }
  .jr:last-child { border-bottom: 0; }
  .jr .link { justify-self: end; }
  .name { font-weight: 500; }
  .st.ok { color: var(--ok-fg); } .st.warn { color: var(--warn-fg); } .st.error { color: var(--danger-fg); }
  @media (max-width: 1240px) { .tools.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tools { grid-template-columns: repeat(3, minmax(0, 1fr)); } .jr { grid-template-columns: 100px minmax(0, 1fr) 200px 90px 70px; } }
</style>
