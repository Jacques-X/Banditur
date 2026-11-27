<script>
  import { projects, eventWork, useEvent } from '../lib/projects.svelte.js';
  import { studioJobs } from '../lib/studio-jobs.svelte.js';
  import { openProject } from '../lib/handoff.svelte.js';
  import { app, go, openTool, openSettings, profileName, ls } from '../lib/app.svelte.js';
  import { longDate, DAYS } from '../lib/format.js';
  import { cal, eventsFor, slotsFor, today } from './kalendarju/calendar.svelte.js';
  import { comingDue, isOpen, slotTimes, STATUS_NAMES } from './kalendarju/campaigns.js';
  import { occurrences, addDays, dayOf, timeOf } from './kalendarju/model.js';
  import { invoke, isTauri, isMock } from '../lib/tauri.js';
  import { marks, refreshPacks } from './marka/packs.svelte.js';

  // What's coming: calendar events and planned posts for the next 14 days, by time.
  function wallLabel(start, allDay) {
    const d = dayOf(start), t = today();
    const day = d === t ? 'Illum' : d === addDays(t, 1) ? 'Għada' : `${DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${+d.slice(8, 10)}/${+d.slice(5, 7)}`;
    return allDay ? day : `${day} · ${timeOf(start)}`;
  }
  const coming = $derived.by(() => {
    if (app.view !== 'home') return [];
    const t = today(), end = addDays(t, 14);
    let events = [];
    try { events = occurrences(eventsFor(app.profileId), t, end); } catch { /* unreadable calendar */ }
    const ev = events.map(o => ({
      key: o.key, sort: o.allDay ? `${o.first}T00:00` : o.start, when: wallLabel(o.start, o.allDay), title: o.event.title,
      kind: 'Avveniment', tone: '', open: () => { cal.day = o.first; cal.focus = o.event.id; go('kalendarju'); },
    }));
    let planned = [];
    try { planned = slotsFor(app.profileId).filter((x) => isOpen(x) && x.day >= t && x.day < end); } catch { /* unreadable calendar */ }
    const posts = planned.map((x) => ({
      key: `slot-${x.id}`, sort: slotTimes(x).allDay ? `${x.day}T00:00` : `${x.day}T${x.time}`, when: wallLabel(slotTimes(x).start, slotTimes(x).allDay), title: x.title,
      kind: `Post ippjanat · ${STATUS_NAMES[x.status]}`, tone: '', open: () => openSlot(x),
    }));
    return [...ev, ...posts].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)).slice(0, 8);
  });

  // Planned posts that must be ready within 3 days (or are late) and are not Lest yet.
  const due = $derived.by(() => {
    if (app.view !== 'home') return [];
    try { return comingDue(slotsFor(app.profileId), today(), 3); } catch { return []; }
  });
  const dueLabel = (d) => { const t = today(); return d < t ? 'Tard' : d === t ? 'Illum' : d === addDays(t, 1) ? 'Għada' : `${DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${+d.slice(8, 10)}/${+d.slice(5, 7)}`; };
  const openSlot = (sl) => { cal.day = sl.day; cal.focusSlot = sl.id; go('kalendarju'); };
  const unfinished=$derived(projects.items.filter(p=>p.kind!=='event' && p.status!=='exported' && (!p.data?.profileId || p.data.profileId===app.profileId)));
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
    { done: !!(app.profiles.length && app.profileId), label: 'Agħżel il-profil', hint: 'Is-sett ta’ Xogħol u Kalendarju li qed taħdem fuqu (fuq ix-xellug tal-bar; Settings → Profili)', act: 'Profili', run: () => openSettings('profili') },
    { done: !marks.loaded || marks.packs.some(p => p.watermarks.length), label: 'Importa l-watermarks', hint: 'Pack .bwpack għal Ritratti', act: 'Watermarks', run: () => openSettings('marki') },
    { done: !comps || (comps.engine !== 'missing' && comps.model !== 'missing'), label: 'Installa l-engine u l-model tat-traskrizzjoni', hint: 'npm run build:local fil-folder tal-proġett', act: 'Components', run: () => openSettings('aggornamenti') },
  ]);
  const setupLeft = $derived(setupHidden ? 0 : setup.filter(s => !s.done).length);
  function hideSetup() { setupHidden = true; ls.set('banditur_setup_hidden', '1'); }
  const toolOf = j => (['raw', 'marka'].includes(j.kind) ? 'ritratti' : j.kind === 'youtube' ? 'youtube' : String(j.kind).startsWith('murtali') ? 'murtali' : 'traskrittura');
  const stuck = $derived(studioJobs.filter(j => ['failed', 'interrupted'].includes(j.state)));
  const running = $derived(studioJobs.filter(j => ['running', 'queued'].includes(j.state)));
  const needsMe = $derived(!!(due.length || stuck.length || running.length || projects.error || unfinished.length));
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

  {#if needsMe}
  <section class="recent" aria-label="Issa">
    <div class="rh"><h2>Issa</h2></div>
    {#if due.length}
      <div class="table card">
        {#each due.slice(0, 6) as d (d.slot.id)}
          <button class="jr" type="button" onclick={() => openSlot(d.slot)}>
            <span class="mono" class:lateTxt={d.late}>Lest sa · {dueLabel(d.due)}</span>
            <span class="truncate name">{d.slot.title}{#if d.slot.owner}<span class="muted">&nbsp;· {d.slot.owner}</span>{/if}</span>
            <span class="small st {d.late ? 'error' : 'warn'}">Post ippjanat · {STATUS_NAMES[d.slot.status]}</span>
          </button>
        {/each}
      </div>
      {#if due.length > 6}<button class="link small" type="button" onclick={() => go('kalendarju')}>+{due.length - 6} oħra fil-Kalendarju</button>{/if}
    {/if}
    {#each stuck.slice(0,4) as j}<button class="btn" onclick={()=>openTool(toolOf(j))}>{j.name} · {j.state==='failed'?'Falla':'Ġie interrott'} · Iftaħ biex tkompli</button>{/each}
    {#each running as j}<button class="btn" onclick={()=>openTool(toolOf(j))}>{j.name} · {j.state==='running'?'Għaddej':'Fil-queue'}</button>{/each}
    {#if projects.error}<div class="notice danger">Ma setax jinżamm il-proġett: {projects.error}</div>{/if}
    {#each unfinished.slice(0,4) as p}<button class="btn" onclick={()=>resumeProject(p)}>Kompli · {p.kind==='subtitles'?'Traskrittura':p.kind==='fireworks'?'Murtali':'Posts'} · {p.name}</button>{/each}
  </section>
  {/if}

  {#if eventWork.id}
  <div class="notice info active-ev">
    <span>Qed taħdem fuq <strong>{eventWork.name || 'avveniment'}</strong> · proġetti ġodda jintrabtu miegħu.</span>
    <span class="spacer"></span>
    <button class="link" type="button" onclick={() => { cal.focus = eventWork.id; go('kalendarju'); }}>Iftaħ</button>
    <button class="link" type="button" onclick={() => useEvent('')}>Ieqaf</button>
  </div>
  {/if}

  <section aria-label="Jmiss" class="recent">
    <div class="rh"><h2>Jmiss</h2><span class="muted small">Avvenimenti u posts ippjanati tal-ġimgħatejn li ġejjin</span><span class="spacer"></span>
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
      <div class="card empty"><strong>Xejn ippjanat għall-ġimgħatejn li ġejjin.</strong>L-avvenimenti u l-posts ippjanati tal-kalendarju jidhru hawn.</div>
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
  .lateTxt { color: var(--danger-fg); font-weight: 600; }
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
