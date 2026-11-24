<script>
  import { projects, eventWork, useEvent } from '../lib/projects.svelte.js';
  import { studioJobs } from '../lib/studio-jobs.svelte.js';
  import { openProject } from '../lib/handoff.svelte.js';
  import { replaceWith } from './skeda/composer.svelte.js';
  import { app, go, openTool, openSettings, profileName, configured, ls, toast } from '../lib/app.svelte.js';
  import { queue, statusOf } from '../lib/queue.svelte.js';
  import { shortDateTime, longDate, whenLabel, DAYS } from '../lib/format.js';
  import { maltaWall } from '../lib/malta-time.js';
  import { cal, eventsFor, today } from './kalendarju/calendar.svelte.js';
  import { occurrences, addDays, dayOf, timeOf } from './kalendarju/model.js';
  import { invoke, isTauri, isMock } from '../lib/tauri.js';
  import ArchivePanel from '../components/ArchivePanel.svelte';
  import { marks, refreshPacks } from './marka/packs.svelte.js';

  // What's coming: queued posts and calendar events for the next 14 days, by time.
  function wallLabel(start, allDay) {
    const d = dayOf(start), t = today();
    const day = d === t ? 'Illum' : d === addDays(t, 1) ? 'Għada' : `${DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${+d.slice(8, 10)}/${+d.slice(5, 7)}`;
    return allDay ? day : `${day} · ${timeOf(start)}`;
  }
  const coming = $derived.by(() => {
    if (app.view !== 'home') return [];
    const t = today(), end = addDays(t, 14), until = Date.now() + 14 * 864e5;
    let events = [];
    try { events = occurrences(eventsFor(app.profileId), t, end); } catch { /* unreadable calendar: posts only */ }
    const ev = events.map(o => ({
      key: o.key, sort: o.allDay ? `${o.first}T00:00` : o.start, when: wallLabel(o.start, o.allDay), title: o.event.title,
      kind: 'Avveniment', tone: '', open: () => { cal.day = o.first; cal.focus = o.event.id; go('kalendarju'); },
    }));
    const posts = queue.upcoming.filter(p => { const at = Date.parse(p.scheduled_time); return at >= Date.now() - 5 * 60000 && at <= until; }).map(p => ({
      key: `post-${p.id}`, sort: maltaWall(new Date(p.scheduled_time)), when: whenLabel(p.scheduled_time), title: (p.caption || '(mingħajr caption)').split('\n')[0],
      kind: statusOf(p).label, tone: 'ok', open: () => go('arkivju'),
    }));
    return [...ev, ...posts].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)).slice(0, 8);
  });

  const overdue=$derived(queue.upcoming.filter(p=>Date.parse(p.scheduled_time)<Date.now()-5*60000));
  const unfinished=$derived(projects.items.filter(p=>p.kind!=='event' && p.status!=='exported' && (!p.data?.profileId || p.data.profileId===app.profileId)));
  async function createEventPost(){try{if(await replaceWith(p=>{p.eventId=eventWork.id;}))go('skeda');}catch(e){toast(e.message,'error');}}
  const resumeProject = openProject;
  const hello = () => { const h = new Date().getHours(); return h < 18 ? 'Bonġu' : 'Bonswa'; };
  // First run: what still has to be set up. Shown until everything is done or it is hidden.
  let comps = $state(null);
  let setupHidden = $state(ls.get('banditur_setup_hidden', '') === '1');
  $effect(() => {
    if (app.view !== 'home' || setupHidden) return;
    if (!marks.loaded) refreshPacks().catch(() => {});
    if (!comps && (isTauri || isMock())) invoke('components_status').then(c => (comps = c)).catch(() => {});
  });
  const setup = $derived([
    { done: configured() || isMock(), label: 'Qabbad mal-backend', hint: 'Backend URL u API Key, għall-iskedar u l-arkivju', act: 'Connection', run: () => openSettings('konnessjoni') },
    { done: !!(app.profiles.length && app.profileId), label: 'Agħżel il-profil', hint: 'Il-paġna u l-kont li qed taħdem fuqhom (fuq ix-xellug tal-bar)', act: '', run: null },
    { done: !marks.loaded || marks.packs.some(p => p.watermarks.length), label: 'Importa l-watermarks', hint: 'Pack .bwpack għal Ritratti', act: 'Watermarks', run: () => openSettings('marki') },
    { done: !comps || (comps.engine !== 'missing' && comps.model !== 'missing'), label: 'Installa l-engine u l-model tat-traskrizzjoni', hint: 'npm run build:local fil-folder tal-proġett', act: 'Components', run: () => openSettings('aggornamenti') },
  ]);
  const setupLeft = $derived(setupHidden ? 0 : setup.filter(s => !s.done).length);
  function hideSetup() { setupHidden = true; ls.set('banditur_setup_hidden', '1'); }
  const toolOf = j => (['raw', 'marka'].includes(j.kind) ? 'ritratti' : j.kind === 'youtube' ? 'youtube' : 'traskrittura');
  const stuck = $derived(studioJobs.filter(j => ['failed', 'interrupted'].includes(j.state)));
  const running = $derived(studioJobs.filter(j => ['running', 'queued'].includes(j.state)));
  const needsMe = $derived(!!(queue.error || app.failed || overdue.length || stuck.length || running.length || projects.error || unfinished.length));
</script>

<div class="studio scroll">
  <div>
    <h1>{hello()}</h1>
    <p class="muted lead">{longDate(new Date())} · {profileName()}</p>
  </div>

  {#if setupLeft}
  <section class="recent" aria-label="Ibda hawn">
    <div class="rh"><h2>Ibda hawn</h2><span class="muted small">{setupLeft === 1 ? 'Fadal pass wieħed' : `Fadal ${setupLeft} passi`}</span><span class="spacer"></span><button class="link small" type="button" onclick={hideSetup}>Aħbi</button></div>
    <div class="table card">
      {#each setup as s (s.label)}
        <div class="sr" class:done={s.done}>
          <span class="tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
          <span><strong>{s.label}</strong><span class="muted small"> · {s.hint}</span></span>
          {#if !s.done && s.run}<button class="btn sm" type="button" onclick={s.run}>{s.act}</button>{:else}<span></span>{/if}
        </div>
      {/each}
    </div>
  </section>
  {/if}

  <ArchivePanel />

  {#if needsMe}
  <section class="recent" aria-label="Issa">
    <div class="rh"><h2>Issa</h2></div>
    {#if queue.error}<div class="notice danger">{queue.error}<button class="link" onclick={()=>openSettings('sistema')}>Iċċekkja l-konnessjoni</button></div>{/if}
    {#if app.failed}<div class="notice danger">{app.failed} posts għandhom destinazzjonijiet li fallew jew iridu verifika.<button class="link" onclick={()=>go('arkivju')}>Ara d-dettalji</button></div>{/if}
    {#each overdue as p}<button class="btn" onclick={()=>go('arkivju')}>Post li għadda l-ħin tiegħu · {shortDateTime(p.scheduled_time)} · {(p.caption || '').slice(0,80)}</button>{/each}
    {#each stuck.slice(0,4) as j}<button class="btn" onclick={()=>openTool(toolOf(j))}>{j.name} · {j.state==='failed'?'Falla':'Ġie interrott'} · Iftaħ biex tkompli</button>{/each}
    {#each running as j}<button class="btn" onclick={()=>openTool(toolOf(j))}>{j.name} · {j.state==='running'?'Għaddej':'Fil-queue'}</button>{/each}
    {#if projects.error}<div class="notice danger">Ma setax jinżamm il-proġett: {projects.error}</div>{/if}
    {#each unfinished.slice(0,4) as p}<button class="btn" onclick={()=>resumeProject(p)}>Kompli · {p.kind==='subtitles'?'Traskrittura':'Posts'} · {p.name}</button>{/each}
  </section>
  {/if}

  {#if eventWork.id}
  <div class="notice info active-ev">
    <span>Qed taħdem fuq <strong>{eventWork.name || 'avveniment'}</strong> · posts u proġetti ġodda jintrabtu miegħu.</span>
    <span class="spacer"></span>
    <button class="link" type="button" onclick={() => { cal.focus = eventWork.id; go('kalendarju'); }}>Iftaħ</button>
    <button class="link" type="button" onclick={createEventPost}>Post ġdid</button>
    <button class="link" type="button" onclick={() => useEvent('')}>Ieqaf</button>
  </div>
  {/if}

  <section aria-label="Jmiss" class="recent">
    <div class="rh"><h2>Jmiss</h2><span class="muted small">Posts u avvenimenti tal-ġimgħatejn li ġejjin</span><span class="spacer"></span>
      <button class="link small" type="button" onclick={() => go('skeda')}>Post ġdid</button>
      <button class="link small" type="button" onclick={() => go('kalendarju')}>Kalendarju</button>
    </div>
    {#if coming.length}
      <div class="table card">
        {#each coming as c (c.key)}
          <button class="jr" type="button" onclick={c.open}>
            <span class="mono muted">{c.when}</span>
            <span class="truncate name">{c.title}</span>
            <span class="small st {c.tone}">{c.kind}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="card empty"><strong>Xejn skedat għall-ġimgħatejn li ġejjin.</strong>Il-posts skedati u l-avvenimenti tal-kalendarju jidhru hawn.</div>
    {/if}
  </section>
</div>

<style>
  .studio { flex: 1; padding: 36px max(40px, calc((100% - 1200px) / 2)); display: flex; flex-direction: column; gap: 28px; }
  .lead { margin-top: 4px; }
  .recent { display: flex; flex-direction: column; gap: 10px; }
  .rh { display: flex; align-items: baseline; gap: 10px; }
  .table { overflow: hidden; }
  .jr { display: grid; grid-template-columns: 170px minmax(0, 1fr) 160px; gap: 16px; align-items: center; padding: 11px 16px; border: 0; border-bottom: 1px solid var(--line-soft); background: none; color: var(--fg); text-align: left; width: 100%; }
  .jr:hover { background: var(--hover); }
  .jr:last-child { border-bottom: 0; }
  .name { font-weight: 500; }
  .st.ok { color: var(--ok-fg); } .st.warn { color: var(--warn-fg); } .st.error { color: var(--danger-fg); }
  .st { justify-self: end; }
  .active-ev { display: flex; align-items: center; gap: 12px; }
  .sr { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 16px; border-bottom: 1px solid var(--line-soft); }
  .sr:last-child { border-bottom: 0; }
  .sr.done { color: var(--muted); }
  .tick { width: 20px; height: 20px; border-radius: 10px; border: 1.5px solid var(--line-strong); display: grid; place-items: center; font-size: 12px; font-weight: 700; color: var(--ok-fg); }
  .sr.done .tick { border-color: var(--ok); background: var(--ok-bg, transparent); }
  @media (max-width: 1240px) { .jr { grid-template-columns: 140px minmax(0, 1fr) 130px; } }
</style>
