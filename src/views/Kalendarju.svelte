<script>
  // Kalendarju: our own calendar, kept on this computer (see kalendarju/). Events, labels, the
  // scheduled-posts layer from the backend, and the event workspaces on Home.
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import MonthGrid from './kalendarju/MonthGrid.svelte';
  import TimeGrid from './kalendarju/TimeGrid.svelte';
  import AgendaList from './kalendarju/AgendaList.svelte';
  import { app, toast, confirm, go, configured } from '../lib/app.svelte.js';
  import { api } from '../lib/api.js';
  import { isMock } from '../lib/tauri.js';
  import { maltaInstant, maltaWall } from '../lib/malta-time.js';
  import { statusOf } from '../lib/queue.svelte.js';
  import { DAYS_LONG, MONTHS, MONTHS_SHORT } from '../lib/format.js';
  import { useEvent, eventWork, saveProject } from '../lib/projects.svelte.js';
  import { CONFIRM } from '../strings.js';
  import { applyState, openQueued, replaceWith } from './skeda/composer.svelte.js';
  import { cal, VIEWS, today, load, rangeFor, setView, setShowPosts, step, colorOf, isVisible, createEvent, updateEvent, removeEvent, setLabels } from './kalendarju/calendar.svelte.js';
  import { addDays, addMonths, mondayOf, monthGrid, occurrences, moved, shiftWall, wallOf, dayOf, timeOf, weekday } from './kalendarju/model.js';

  let { active } = $props();

  $effect(() => { app.profileId; untrack(load); });
  $effect(() => { if (active) untrack(load); });

  // ── What is on screen ─────────────────────────────────────────────────────
  const range = $derived(rangeFor(cal.view, cal.day));
  const todayStr = $derived.by(() => { active; return today(); });
  const weeks = $derived(monthGrid(cal.day));
  const days = $derived(cal.view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cal.day), i)) : [cal.day]);

  let posts = $state([]);
  let postsError = $state('');
  let token = 0;
  async function loadPosts() {
    if (!cal.showPosts || !(configured() || isMock())) { posts = []; postsError = ''; return; }
    const my = ++token;
    try {
      const all = [];
      let page = 1, total = 1;
      while (all.length < total) {
        const r = await api('/api/history', { query: { from: maltaInstant(range[0] + 'T00:00'), to: maltaInstant(range[1] + 'T00:00'), limit: 100, page, profile_id: app.profileId, ascending: true, status: 'all' } });
        all.push(...(r.posts || []));
        total = r.total || 0;
        if (!r.posts?.length) break;
        page++;
      }
      if (my === token) { posts = all.filter((p) => p.scheduled_time); postsError = ''; }
    } catch (e) {
      if (my === token) { posts = []; postsError = `Ma stajniex naqraw il-posts skedati. ${e.message}`; }
    }
  }
  $effect(() => { if (active) { range; app.profileId; cal.showPosts; untrack(loadPosts); } });

  const MOVABLE = ['pending', 'fb_native'];
  const postItem = (p) => {
    const start = maltaWall(p.scheduled_time);
    const first = dayOf(start);
    return { key: `post:${p.id}`, kind: 'post', ref: p, title: `${(p.platforms || []).join('/').toUpperCase()} · ${(p.caption || 'Post').split('\n')[0]}`, color: 'var(--accent)', start, end: shiftWall(start, 30), allDay: false, first, last: first, movable: MOVABLE.includes(p.status) };
  };
  const eventItems = $derived(
    occurrences(cal.events.filter((e) => isVisible(e.label)), range[0], range[1]).map((o) => ({
      key: o.key, kind: 'event', ref: o, title: o.event.title, color: colorOf(o.event.label), start: o.start, end: o.end, allDay: o.allDay, first: o.first, last: o.last, movable: true, repeat: !!o.event.repeat,
    })),
  );
  const items = $derived(
    [...eventItems, ...(cal.showPosts ? posts.map(postItem) : [])].sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) : a.allDay ? -1 : 1)),
  );
  const dayItems = $derived(items.filter((i) => i.first <= cal.day && cal.day <= i.last));

  const title = $derived.by(() => {
    const d = cal.day, m = (s) => MONTHS[+s.slice(5, 7) - 1];
    if (cal.view === 'day') return `${+d.slice(8)} ta' ${m(d)} ${d.slice(0, 4)}`;
    if (cal.view === 'week') {
      const a = days[0], b = days[6];
      return `${+a.slice(8)} ${MONTHS_SHORT[+a.slice(5, 7) - 1]} – ${+b.slice(8)} ${MONTHS_SHORT[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}`;
    }
    return `${m(d)} ${d.slice(0, 4)}`;
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  const pick = (d) => { cal.day = d; inspector = null; };
  async function openItem(it) {
    if (it.kind === 'post') {
      if (await openQueued(it.ref, !MOVABLE.includes(it.ref.status))) go('skeda');
      return;
    }
    openEdit(it.ref.event);
  }
  async function moveItem(it, dDays, dMin) {
    try {
      if (it.kind === 'event') {
        updateEvent(it.ref.event.id, moved(it.ref.event, dDays, dMin));
        return;
      }
      const p = it.ref;
      await api(`/api/posts/${p.id}`, { method: 'PATCH', body: { revision: p.revision, scheduledTime: maltaInstant(shiftWall(it.start, dDays * 1440 + dMin)) } });
      toast('Il-post ġie skedat mill-ġdid.', 'ok');
      loadPosts();
    } catch (e) { toast(e.message, 'error'); loadPosts(); }
  }
  async function newPostForDay() {
    const done = await replaceWith(() => applyState({ scheduledTime: cal.day + 'T18:30', platforms: ['fb', 'ig'], eventId: eventWork.id }, []));
    if (done) go('skeda');
  }

  // ── Event form ────────────────────────────────────────────────────────────
  let inspector = $state(null);
  let saving = false;
  function openCreate(day = cal.day, minutes = 19 * 60) {
    const start = wallOf(day, minutes);
    cal.day = day;
    inspector = { mode: 'create', id: null, revision: null, title: '', label: '', allDay: false, start, location: '', description: '', freq: '', interval: 1, until: '' };
  }
  function openEdit(e) {
    cal.day = dayOf(e.start);
    inspector = { mode: 'edit', id: e.id, revision: e.revision, title: e.title, label: e.label || '', allDay: e.allDay, start: e.start, location: e.location || '', description: e.description || '', freq: e.repeat?.freq || '', interval: e.repeat?.interval || 1, until: e.repeat?.until || '' };
  }
  // An event has one time (like a post); the grids show it as a short block.
  const SLOT = 30;
  function toggleAllDay(on) {
    const d = dayOf(inspector.start);
    inspector.allDay = on;
    inspector.start = on ? d : wallOf(d, 9 * 60);
  }
  function save() {
    if (saving) return;
    const i = inspector;
    const body = { title: i.title, label: i.label, allDay: i.allDay, start: i.start, end: i.allDay ? addDays(dayOf(i.start), 1) : shiftWall(i.start, SLOT), location: i.location, description: i.description, repeat: i.freq ? { freq: i.freq, interval: i.interval, until: i.until || null } : null };
    saving = true;
    try {
      if (i.mode === 'edit') updateEvent(i.id, { ...body, revision: i.revision });
      else createEvent(body);
      toast(i.mode === 'edit' ? 'Avveniment issejvjat.' : 'Avveniment miżjud.', 'ok');
      cal.day = dayOf(body.start);
      inspector = null;
    } catch (e) { toast(e.message, 'error'); }
    saving = false;
  }
  async function remove() {
    const rep = inspector.freq ? ' Tinħassar is-sensiela kollha.' : '';
    if (!await confirm(CONFIRM.delete_event + rep, { yes: 'Ħassar', no: 'Żomm', danger: true })) return;
    try { removeEvent(inspector.id); toast('Avveniment imħassar.', 'ok'); inspector = null; } catch (e) { toast(e.message, 'error'); }
  }
  async function openWorkspace(e) {
    useEvent(e.id, e.title);
    await saveProject({ id: `event-${e.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}`, version: 1, kind: 'event', name: e.title, eventId: e.id, data: { event: e, profileId: app.profileId } });
    go('home');
  }

  // ── Labels ────────────────────────────────────────────────────────────────
  let newLabel = $state({ name: '', color: '#3355D1' });
  const editLabels = (fn) => { try { setLabels(fn(cal.labels.map((l) => ({ ...l })))); } catch (e) { toast(e.message, 'error'); } };
  const dayEvents = $derived(dayItems.filter((i) => i.kind === 'event'));
  const dayPosts = $derived(dayItems.filter((i) => i.kind === 'post'));
</script>

<div class="cal">
  <section class="main">
    <div class="head">
      <h1 class="title">{title}</h1>
      <div class="nav">
        <button class="btn icon" type="button" aria-label="Ta' qabel" onclick={() => step(-1)}><Icon name="chevronLeft" /></button>
        <button class="btn" type="button" onclick={() => (cal.day = today())}>Illum</button>
        <button class="btn icon" type="button" aria-label="Li jmiss" onclick={() => step(1)}><Icon name="chevronRight" /></button>
      </div>
      <div class="seg" role="group" aria-label="Veduta">
        {#each VIEWS as [v, label]}<button type="button" aria-pressed={cal.view === v} onclick={() => setView(v)}>{label}</button>{/each}
      </div>
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" checked={cal.showPosts} onchange={(e) => setShowPosts(e.currentTarget.checked)} />Posts</label>
      <span class="muted small">Ħin ta’ Malta</span>
      <button class="btn primary" type="button" onclick={() => openCreate()}><Icon name="plus" size={15} />Avveniment</button>
    </div>
    {#if postsError}<div class="notice danger" role="status">{postsError}</div>{/if}
    {#if cal.view === 'month'}
      <MonthGrid {weeks} day={cal.day} today={todayStr} month={cal.day.slice(0, 7)} {items} onselect={pick} onopen={openItem} onmove={moveItem} />
    {:else if cal.view === 'list'}
      <AgendaList from={range[0]} to={range[1]} {items} today={todayStr} onopen={openItem} onselect={pick} />
    {:else}
      <TimeGrid {days} {items} today={todayStr} selected={cal.day} onselect={pick} onopen={openItem} onmove={moveItem} oncreate={(d, m) => openCreate(d, m)} />
    {/if}
  </section>

  <aside class="side" aria-label="Il-jum magħżul">
    {#if inspector}
      <form class="insp" onsubmit={(e) => { e.preventDefault(); save(); }}>
        <div class="insp-h"><h2>{inspector.mode === 'create' ? 'Avveniment ġdid' : 'Editja l-avveniment'}</h2>
          <button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={() => (inspector = null)}><Icon name="x" /></button></div>
        <div class="field"><label class="label" for="ev-title">Titlu</label><input id="ev-title" class="input" bind:value={inspector.title} /></div>
        <div class="field"><label class="label" for="ev-label">Label</label>
          <select id="ev-label" class="select" bind:value={inspector.label}>
            <option value="">Bla label</option>
            {#each cal.labels as l}<option value={l.name}>{l.name}</option>{/each}
          </select></div>
        <label class="check"><input type="checkbox" checked={inspector.allDay} onchange={(e) => toggleAllDay(e.currentTarget.checked)} />Il-jum kollu</label>
        <div class="field"><label class="label" for="ev-s">{inspector.allDay ? 'Jum' : 'Ħin'}</label><input id="ev-s" class="input" type={inspector.allDay ? 'date' : 'datetime-local'} bind:value={inspector.start} /></div>
        <div class="field"><label class="label" for="ev-r">Jirrepeti</label>
          <select id="ev-r" class="select" bind:value={inspector.freq}>
            <option value="">Le</option><option value="daily">Kuljum</option><option value="weekly">Kull ġimgħa</option><option value="monthly">Kull xahar</option><option value="yearly">Kull sena</option>
          </select></div>
        {#if inspector.freq}
          <div class="two">
            <div class="field"><label class="label" for="ev-i">Kull</label><input id="ev-i" class="input" type="number" min="1" max="30" bind:value={inspector.interval} /></div>
            <div class="field"><label class="label" for="ev-u">Sa</label><input id="ev-u" class="input" type="date" bind:value={inspector.until} /></div>
          </div>
        {/if}
        <div class="field"><label class="label" for="ev-loc">Post</label><input id="ev-loc" class="input" bind:value={inspector.location} /></div>
        <div class="field"><label class="label" for="ev-desc">Noti</label><textarea id="ev-desc" class="textarea" rows="3" bind:value={inspector.description}></textarea></div>
        <div class="insp-actions">
          <button class="btn primary" type="submit">Save</button>
          {#if inspector.mode === 'edit'}
            <button class="btn" type="button" onclick={() => openWorkspace(cal.events.find((x) => x.id === inspector.id))}>Xogħol tal-avveniment</button>
            <button class="link danger" type="button" onclick={remove}>Ħassar</button>
          {/if}
        </div>
      </form>
    {:else}
      <div><div class="muted small">{DAYS_LONG[(weekday(cal.day) + 0) % 7]}</div><h2 class="day">{+cal.day.slice(8)} ta' {MONTHS[+cal.day.slice(5, 7) - 1]}</h2></div>
      <div class="sec">
        <div class="sec-h">Avvenimenti</div>
        {#each dayEvents as it (it.key)}
          <button class="ev" type="button" onclick={() => openItem(it)}>
            <span class="bar" style="background: {it.color}"></span>
            <span class="ev-t"><b>{it.title}</b><span class="mono muted">{it.allDay ? 'Il-jum kollu' : timeOf(it.start)}{it.repeat ? ' · ↻' : ''}</span></span>
          </button>
        {:else}
          <p class="muted small">L-ebda avveniment f'dan il-jum.</p>
        {/each}
      </div>
      <div class="sec">
        <div class="sec-h">Posts skedati <span class="muted small">· jinbidlu mill-Arkivju</span></div>
        {#each dayPosts as it (it.key)}
          {@const s = statusOf(it.ref)}
          <button class="ev" type="button" onclick={() => openItem(it)}><span class="mono muted">{timeOf(it.start)}</span><span class="truncate">{it.title}</span><span class="pill {s.tone}">{s.label}</span></button>
        {:else}
          <p class="muted small">L-ebda post skedat.</p>
        {/each}
        <button class="link small" type="button" onclick={newPostForDay}>+ Skeda post għal dan il-jum</button>
      </div>
      {#if dayEvents.length}
        <div class="sec"><div class="sec-h">Xogħol tal-avveniment</div>
          {#each dayEvents as it (it.key)}<button class="btn sm" type="button" onclick={() => openWorkspace(it.ref.event)}>{it.title} · Iftaħ ix-xogħol</button>{/each}
        </div>
      {/if}
      <div class="sec labels">
        <div class="sec-h">Labels</div>
        {#each cal.labels as l (l.name)}
          <div class="lab">
            <input type="checkbox" checked={l.visible !== false} aria-label="Uri {l.name}" onchange={(e) => editLabels((all) => all.map((x) => (x.name === l.name ? { ...x, visible: e.currentTarget.checked } : x)))} />
            <input type="color" value={l.color} aria-label="Kulur ta' {l.name}" onchange={(e) => editLabels((all) => all.map((x) => (x.name === l.name ? { ...x, color: e.currentTarget.value } : x)))} />
            <span class="truncate">{l.name}</span>
            <button class="x" type="button" aria-label="Neħħi t-label {l.name}" onclick={async () => { if (await confirm(`Tneħħi t-label "${l.name}"? L-avvenimenti jibqgħu bla label.`, { yes: 'Neħħi', no: 'Żomm', danger: true })) editLabels((all) => all.filter((x) => x.name !== l.name)); }}><Icon name="x" size={12} /></button>
          </div>
        {/each}
        <form class="lab add" onsubmit={(e) => { e.preventDefault(); const n = newLabel.name.trim(); if (!n) return; editLabels((all) => [...all, { name: n, color: newLabel.color, visible: true }]); newLabel.name = ''; }}>
          <input type="color" bind:value={newLabel.color} aria-label="Kulur" />
          <input class="input" bind:value={newLabel.name} placeholder="Label ġdid" aria-label="Isem tat-label l-ġdida" />
          <button class="btn sm" type="submit">Żid</button>
        </form>
      </div>
    {/if}
  </aside>
</div>

<style>
  .cal { overflow: hidden; display: flex; gap: 16px; height: 100%; min-height: 0; padding: 16px 20px; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .title { font-size: 20px; margin: 0 8px 0 0; }
  .nav { display: flex; gap: 4px; }
  .spacer { flex: 1; }
  .side { width: 300px; flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .day { margin: 0; font-size: 20px; }
  .sec { display: flex; flex-direction: column; gap: 6px; }
  .sec-h { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .ev { all: unset; box-sizing: border-box; display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-size: 13px; width: 100%; }
  .ev:hover { background: var(--hover); }
  .ev .bar { width: 4px; align-self: stretch; border-radius: 2px; }
  .ev-t { display: flex; flex-direction: column; min-width: 0; }
  .mono { font-family: var(--font-mono); font-size: 11.5px; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .insp { display: flex; flex-direction: column; gap: 10px; }
  .insp-h { display: flex; justify-content: space-between; align-items: center; }
  .insp-h h2 { margin: 0; font-size: 16px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .insp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .lab { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .lab input[type='color'] { width: 22px; height: 22px; padding: 0; border: 0; background: none; }
  .lab .x { all: unset; cursor: pointer; color: var(--muted); padding: 2px; }
  .lab .x:hover { color: var(--danger-fg); }
  .lab.add .input { flex: 1; min-width: 0; }
</style>
