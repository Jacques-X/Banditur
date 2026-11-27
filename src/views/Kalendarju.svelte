<script>
  // Kalendarju: our own calendar, kept on this computer (see kalendarju/). Events, labels, and each
  // event's page (kalendarju/EventPage.svelte). Campaign planning: campaigns (date ranges with a
  // weekly post target, CampaignPage / PlanView), planned posts ("slots", SlotForm) with a status
  // you set by hand (the last one, Ippubblikat, means it went out), and empty days flagged.
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import MonthGrid from './kalendarju/MonthGrid.svelte';
  import TimeGrid from './kalendarju/TimeGrid.svelte';
  import AgendaList from './kalendarju/AgendaList.svelte';
  import EventPage from './kalendarju/EventPage.svelte';
  import SlotForm from './kalendarju/SlotForm.svelte';
  import CampaignForm from './kalendarju/CampaignForm.svelte';
  import CampaignPage from './kalendarju/CampaignPage.svelte';
  import PlanView from './kalendarju/PlanView.svelte';
  import { campaignsOn, campaignWeeks, defaultCampaign, slotTimes, movedSlot, emptyDays, dueOf, STATUS_NAMES } from './kalendarju/campaigns.js';
  import { app, toast, go } from '../lib/app.svelte.js';
  import { DAYS_LONG, MONTHS, MONTHS_SHORT } from '../lib/format.js';
  import { MONTHS_SHORT as MS } from '../lib/format.js';
  import { board as xoghol, load as loadXoghol, addTask } from './xoghol/board.svelte.js';
  import { sortedColumns } from './xoghol/model.js';
  import { cal, VIEWS, today, load, rangeFor, setView, step, colorOf, isVisible, createEvent, updateEvent, removeEvent, setLabels,
    setCampaignFilter, campaignOf, createCampaign, updateCampaign, removeCampaign, createSlot, updateSlot, removeSlot } from './kalendarju/calendar.svelte.js';
  import { STORAGE_KEY as CAL_KEY } from './kalendarju/local-store.js';
  import { withUndo } from '../lib/undo.js';
  import { addDays, addMonths, mondayOf, monthGrid, occurrences, moved, shiftWall, wallOf, dayOf, timeOf, weekday } from './kalendarju/model.js';

  let { active } = $props();

  $effect(() => { app.profileId; untrack(load); });
  $effect(() => { if (active) untrack(load); });

  // ── What is on screen ─────────────────────────────────────────────────────
  const range = $derived(rangeFor(cal.view, cal.day));
  const todayStr = $derived.by(() => { active; return today(); });
  const weeks = $derived(monthGrid(cal.day));
  const days = $derived(cal.view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cal.day), i)) : [cal.day]);

  // ── Campaign filter (header) ──
  const filterC = $derived(cal.campaign ? campaignOf(cal.campaign) : null);
  const shownCampaigns = $derived(filterC ? [filterC] : cal.campaigns);
  const slotColor = (s) => campaignOf(s.campaign)?.color || '#7B808A';
  const slotItem = (s) => ({ key: `slot:${s.id}`, kind: 'slot', ref: s, title: s.title, color: slotColor(s), ...slotTimes(s), first: s.day, last: s.day, movable: true, status: STATUS_NAMES[s.status] });
  const slotItems = $derived(cal.slots.filter((s) => s.day >= range[0] && s.day < range[1] && (!filterC || s.campaign === filterC.id)).map(slotItem));
  const eventItems = $derived(
    occurrences(cal.events.filter((e) => isVisible(e.label) && (!filterC || e.campaign === filterC.id)), range[0], range[1]).map((o) => ({
      key: o.key, kind: 'event', ref: o, title: o.event.title, color: colorOf(o.event.label), start: o.start, end: o.end, allDay: o.allDay, first: o.first, last: o.last, movable: true, repeat: !!o.event.repeat,
    })),
  );
  const items = $derived(
    [...eventItems, ...slotItems].sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) : a.allDay ? -1 : 1)),
  );
  const dayItems = $derived(items.filter((i) => i.first <= cal.day && cal.day <= i.last));
  // Days with something planned (any status), for weekly counts and gaps. A campaign counts only
  // the planned posts linked to it, whatever the date.
  const dated = $derived(cal.slots.map((s) => s.day));
  const datedFor = (c) => cal.slots.filter((s) => s.campaign === c.id).map((s) => s.day);
  const gaps = $derived.by(() => {
    const out = new Set();
    // Only in weeks below the campaign's target (no target, no marks): an empty day is fine
    // when the week already has enough.
    for (const c of shownCampaigns) {
      if (!c.target) continue;
      const mine = datedFor(c);
      const short = new Set(campaignWeeks(c, mine).filter((w) => w.short).map((w) => w.week));
      for (const d of emptyDays(c, mine, todayStr)) if (d >= range[0] && d < range[1] && short.has(mondayOf(d))) out.add(d);
    }
    return out;
  });
  const bandsOn = (d) => campaignsOn(shownCampaigns, d);

  const title = $derived.by(() => {
    const d = cal.day, m = (s) => MONTHS[+s.slice(5, 7) - 1];
    if (cal.view === 'day') return `${+d.slice(8)} ta' ${m(d)} ${d.slice(0, 4)}`;
    if (cal.view === 'plan') {
      const a = d.slice(0, 7) + '-01', b = addMonths(a, 2);
      return `${MS[+a.slice(5, 7) - 1]} ${a.slice(0, 4) === b.slice(0, 4) ? '' : a.slice(0, 4) + ' '}– ${MS[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}`;
    }
    if (cal.view === 'week') {
      const a = days[0], b = days[6];
      return `${+a.slice(8)} ${MONTHS_SHORT[+a.slice(5, 7) - 1]} – ${+b.slice(8)} ${MONTHS_SHORT[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}`;
    }
    return `${m(d)} ${d.slice(0, 4)}`;
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  const pick = (d) => { cal.day = d; closePanels(); };
  /** Close whatever the side panel shows, back to the selected day. */
  function closePanels() { inspector = null; page = null; slotForm = null; campaignForm = null; campPage = ''; }
  // The event whose page is open in the side panel (a repeating event: its series).
  let page = $state(null);
  const pageEvent = $derived(page ? cal.events.find((e) => e.id === page) || null : null);
  $effect(() => {
    if (!active || !cal.focus) return;
    const id = cal.focus;
    cal.focus = '';
    untrack(async () => {
      let e = cal.events.find((x) => x.id === id);
      if (!e) { await load(); e = cal.events.find((x) => x.id === id); }
      if (e) { cal.day = dayOf(e.start); closePanels(); page = e.id; }
    });
  });
  function openItem(it) {
    if (it.kind === 'slot') { openSlot(it.ref); return; }
    closePanels();
    page = it.ref.event.id;
  }
  function moveItem(it, dDays, dMin) {
    try {
      if (it.kind === 'event') {
        updateEvent(it.ref.event.id, moved(it.ref.event, dDays, dMin));
        return;
      }
      if (it.kind === 'slot') {
        updateSlot(it.ref.id, movedSlot(it.ref, dDays, dMin));
        return;
      }
    } catch (e) { toast(e.message, 'error'); }
  }
  // ── Event form ────────────────────────────────────────────────────────────
  let inspector = $state(null);
  let saving = false;
  function openCreate(day = cal.day, minutes = 19 * 60) {
    const start = wallOf(day, minutes);
    cal.day = day;
    closePanels();
    inspector = { mode: 'create', id: null, revision: null, title: '', label: '', allDay: false, start, location: '', description: '', freq: '', interval: 1, until: '', campaign: filterC?.id || defaultCampaign(cal.campaigns, day) };
  }
  function openEdit(e) {
    cal.day = dayOf(e.start);
    closePanels();
    inspector = { mode: 'edit', id: e.id, revision: e.revision, title: e.title, label: e.label || '', allDay: e.allDay, start: e.start, location: e.location || '', description: e.description || '', freq: e.repeat?.freq || '', interval: e.repeat?.interval || 1, until: e.repeat?.until || '', campaign: e.campaign || '' };
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
    const body = { title: i.title, label: i.label, allDay: i.allDay, start: i.start, end: i.allDay ? addDays(dayOf(i.start), 1) : shiftWall(i.start, SLOT), location: i.location, description: i.description, repeat: i.freq ? { freq: i.freq, interval: i.interval, until: i.until || null } : null, campaign: i.campaign || '' };
    saving = true;
    try {
      if (i.mode === 'edit') updateEvent(i.id, { ...body, revision: i.revision });
      else page = createEvent(body)?.id || null;
      toast(i.mode === 'edit' ? 'Avveniment issejvjat.' : 'Avveniment miżjud.', 'ok');
      cal.day = dayOf(body.start);
      inspector = null;
    } catch (e) { toast(e.message, 'error'); }
    saving = false;
  }
  /** Delete now, Undo in the toast. */
  const deleting = (message, change) => withUndo(CAL_KEY, message, change, load);
  async function remove() {
    const id = inspector.id, series = !!inspector.freq;
    try {
      await deleting(series ? 'Is-sensiela tħassret.' : 'Avveniment imħassar.', () => removeEvent(id));
      inspector = null;
      page = null;
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Planned posts (slots) ─────────────────────────────────────────────────
  let slotForm = $state(null); // the slot being edited (a copy), or null
  let slotKey = $state(0);
  const SLOT_FIELDS = ['title', 'day', 'time', 'platforms', 'status', 'campaign', 'event', 'notes', 'owner', 'due', 'category'];
  const slotFields = (f) => Object.fromEntries(SLOT_FIELDS.map((k) => [k, f[k]]));
  function openSlot(s) { closePanels(); cal.day = s.day; slotForm = { ...s }; slotKey++; }
  function newSlot(day = cal.day) {
    closePanels();
    cal.day = day;
    const ev = occurrences(cal.events, day, addDays(day, 1))[0]?.event;
    slotForm = { id: '', title: '', day, time: '', platforms: ['fb', 'ig'], status: 'idea', campaign: filterC?.id || ev?.campaign || defaultCampaign(cal.campaigns, day), event: ev?.id || '', notes: '', owner: '', due: '', category: '' };
    slotKey++;
  }
  /** Save the form; returns the saved slot (or null after an error toast). */
  function storeSlot(f, extra = {}) {
    try {
      return f.id ? updateSlot(f.id, { ...slotFields(f), ...extra, revision: f.revision }) : createSlot({ ...slotFields(f), ...extra });
    } catch (e) { toast(e.message, 'error'); return null; }
  }
  function saveSlot(f) {
    const s = storeSlot(f);
    if (!s) return;
    toast(f.id ? 'Post ippjanat issejvjat.' : 'Post ippjanat miżjud.', 'ok');
    cal.day = s.day;
    slotForm = null;
  }
  async function removeSlotNow() {
    const s = slotForm;
    try {
      await deleting('Il-post ippjanat tħassar.', () => removeSlot(s.id));
      slotForm = null;
    } catch (e) { toast(e.message, 'error'); }
  }
  /** A card on the Xogħol board on screen (its first column): the planned post, who, and the ready-by day. */
  async function cardFromSlot(f) {
    const s = storeSlot(f);
    if (!s) return;
    if (xoghol.profileId !== app.profileId || !xoghol.loaded) await loadXoghol(app.profileId);
    const cols = sortedColumns(xoghol.columns.filter((c) => c.board_id === xoghol.boardId));
    if (!cols.length) { toast('Agħmel board f’Xogħol l-ewwel.', 'warn', { label: 'Xogħol', onClick: () => go('xoghol') }); return; }
    const row = await addTask(cols[0].id, `Post: ${s.title}${s.owner ? ` (${s.owner})` : ''}`, { due_date: dueOf(s) });
    if (row) toast(`Kard miżjuda f’“${cols[0].title}”.`, 'ok', { label: 'Iftaħ', onClick: () => go('xoghol') });
  }
  const usedOwners = $derived([...new Set(cal.slots.map((s) => s.owner).filter(Boolean))].sort());
  const usedTypes = $derived([...new Set(cal.slots.map((s) => s.category).map((c) => (c || '').trim()).filter(Boolean))]);
  // Home asks for a planned post to be opened.
  $effect(() => {
    if (!active || !cal.focusSlot) return;
    const id = cal.focusSlot;
    cal.focusSlot = '';
    untrack(async () => {
      let sl = cal.slots.find((x) => x.id === id);
      if (!sl) { await load(); sl = cal.slots.find((x) => x.id === id); }
      if (sl) openSlot(sl);
    });
  });
  const daySlots = $derived(cal.slots.filter((s) => s.day === cal.day && (!filterC || s.campaign === filterC.id)).sort((a, b) => (a.time < b.time ? -1 : 1)));

  // ── Campaigns ─────────────────────────────────────────────────────────────
  let campaignForm = $state(null);
  let campKey = $state(0);
  let campPage = $state(''); // the campaign whose page is open
  const campPageC = $derived(campPage ? campaignOf(campPage) : null);
  const PALETTE = ['#C2410C', '#0F766E', '#6D28D9', '#B45309', '#2563EB', '#BE185D', '#15803D'];
  function newCampaign(from = cal.day) {
    closePanels();
    campaignForm = { id: '', name: '', color: PALETTE[cal.campaigns.length % PALETTE.length], from, to: addDays(from, 27), target: 3, goal: '', notes: '' };
    campKey++;
  }
  function editCampaign(c) { closePanels(); campaignForm = { ...c }; campKey++; }
  function openCampaign(c) { closePanels(); campPage = c.id; }
  function saveCampaign(f) {
    const fields = { name: f.name, color: f.color, from: f.from, to: f.to, target: f.target, goal: f.goal, notes: f.notes };
    try {
      const c = f.id ? updateCampaign(f.id, { ...fields, revision: f.revision }) : createCampaign(fields);
      toast(f.id ? 'Kampanja issejvjata.' : 'Kampanja miżjuda.', 'ok');
      closePanels();
      campPage = c.id;
    } catch (e) { toast(e.message, 'error'); }
  }
  async function removeCampaignNow() {
    const c = campaignForm;
    try {
      await deleting(`Il-kampanja "${c.name}" tħassret. L-avvenimenti u l-posts ippjanati tagħha jibqgħu, mingħajr kampanja.`, () => removeCampaign(c.id));
      closePanels();
    } catch (e) { toast(e.message, 'error'); }
  }
  const toggleFilter = (id) => setCampaignFilter(cal.campaign === id ? '' : id);
  // Side list: running and coming campaigns first; finished ones folded away.
  let showPast = $state(false);
  const currentCampaigns = $derived([...cal.campaigns].filter((c) => c.to >= todayStr).sort((a, b) => (a.from < b.from ? -1 : 1)));
  const pastCampaigns = $derived([...cal.campaigns].filter((c) => c.to < todayStr).sort((a, b) => (a.to < b.to ? 1 : -1)));
  const shortDay = (d) => `${+d.slice(8)} ${MS[+d.slice(5, 7) - 1]}`;
  const goTo = (d, view) => { cal.day = d; if (view) setView(view); };

  // ── Labels ────────────────────────────────────────────────────────────────
  let newLabel = $state({ name: '', color: '#3355D1' });
  const editLabels = (fn) => { try { setLabels(fn(cal.labels.map((l) => ({ ...l })))); } catch (e) { toast(e.message, 'error'); } };
  const dayEvents = $derived(dayItems.filter((i) => i.kind === 'event'));
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
      {#if cal.campaigns.length}
        <select class="select sm camp" aria-label="Kampanja" value={filterC?.id || ''} onchange={(e) => setCampaignFilter(e.currentTarget.value)} style:--c={filterC?.color || 'transparent'}>
          <option value="">Kampanji kollha</option>
          {#each cal.campaigns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      {/if}
      <span class="muted small">Ħin ta’ Malta</span>
      <button class="btn" type="button" onclick={() => newSlot()} title="Post li għadu ma sarx: idea, abbozz jew lest"><Icon name="plus" size={15} />Ippjana post</button>
      <button class="btn primary" type="button" onclick={() => openCreate()}><Icon name="plus" size={15} />Avveniment</button>
    </div>
    {#if cal.error}<div class="notice danger" role="status">Il-kalendarju maqsum ma setax jinqara: {cal.error}</div>{/if}
    {#if filterC}<div class="notice info filter" role="status"><span class="sw" style:background={filterC.color}></span>Qed turi biss <b>{filterC.name}</b> ({shortDay(filterC.from)} – {shortDay(filterC.to)}).<button class="link small" type="button" onclick={() => setCampaignFilter('')}>Uri kollox</button></div>{/if}
    {#if cal.view === 'month'}
      <MonthGrid {weeks} day={cal.day} today={todayStr} month={cal.day.slice(0, 7)} {items} bands={bandsOn} {gaps} onselect={pick} onopen={openItem} onmove={moveItem} onband={openCampaign} />
    {:else if cal.view === 'plan'}
      <PlanView from={range[0]} to={range[1]} campaigns={shownCampaigns} {dated} {datedFor} today={todayStr} onopen={openCampaign} onpick={goTo} oncreate={() => newCampaign()} />
    {:else if cal.view === 'list'}
      <AgendaList from={range[0]} to={range[1]} {items} today={todayStr} onopen={openItem} onselect={pick} />
    {:else}
      <TimeGrid {days} {items} today={todayStr} selected={cal.day} onselect={pick} onopen={openItem} onmove={moveItem} oncreate={(d, m) => openCreate(d, m)} />
    {/if}
  </section>

  <aside class="side" aria-label="Il-jum magħżul">
    {#if slotForm}
      {#key slotKey}
        <SlotForm value={slotForm} campaigns={cal.campaigns} events={cal.events} owners={usedOwners} categories={usedTypes} onsave={saveSlot} onremove={removeSlotNow} oncard={cardFromSlot} onclose={() => (slotForm = null)} />
      {/key}
    {:else if campaignForm}
      {#key campKey}
        <CampaignForm value={campaignForm} onsave={saveCampaign} onremove={removeCampaignNow} onclose={() => (campaignForm = null)} />
      {/key}
    {:else if campPageC}
      <CampaignPage campaign={campPageC} slots={cal.slots} events={cal.events} today={todayStr} filtered={cal.campaign === campPageC.id}
        onedit={() => editCampaign(campPageC)} onclose={() => (campPage = '')} onfilter={() => toggleFilter(campPageC.id)}
        onpick={(d, v) => { goTo(d, v); }} onnewslot={(d) => newSlot(d)} onopenslot={openSlot} />
    {:else if inspector}
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
        {#if cal.campaigns.length}
          <div class="field"><label class="label" for="ev-camp">Kampanja</label>
            <select id="ev-camp" class="select" bind:value={inspector.campaign}>
              <option value="">L-ebda</option>
              {#each cal.campaigns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select></div>
        {/if}
        <div class="field"><label class="label" for="ev-loc">Post</label><input id="ev-loc" class="input" bind:value={inspector.location} /></div>
        <div class="field"><label class="label" for="ev-desc">Noti</label><textarea id="ev-desc" class="textarea" rows="3" bind:value={inspector.description}></textarea></div>
        <div class="insp-actions">
          <button class="btn primary" type="submit">Save</button>
          {#if inspector.mode === 'edit'}
            <button class="link danger" type="button" onclick={remove}>Ħassar</button>
          {/if}
        </div>
      </form>
    {:else if pageEvent}
      <EventPage event={pageEvent} onedit={() => openEdit(pageEvent)} onclose={() => (page = null)} />
    {:else}
      <div><div class="muted small">{DAYS_LONG[(weekday(cal.day) + 0) % 7]}</div><h2 class="day">{+cal.day.slice(8)} ta' {MONTHS[+cal.day.slice(5, 7) - 1]}</h2>
        {#each campaignsOn(cal.campaigns, cal.day) as c (c.id)}<button class="cchip" type="button" style:--c={c.color} onclick={() => openCampaign(c)}>{c.name}</button>{/each}
        {#if gaps.has(cal.day)}<div class="notice warn small gapnote">Xejn ippjanat għal dan il-jum, u l-ġimgħa għadha taħt il-mira tal-kampanja.</div>{/if}</div>
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
        <div class="sec-h">Ippjanati</div>
        {#each daySlots as s (s.id)}
          <button class="ev" type="button" onclick={() => openSlot(s)}>
            <span class="bar dotted" style="border-color: {slotColor(s)}"></span>
            <span class="ev-t"><b>{s.title}</b><span class="mono muted">{s.time || 'Matul il-jum'}{s.category ? ` · ${s.category}` : ''}{s.platforms.length ? ` · ${s.platforms.join('/').toUpperCase()}` : ''}</span>{#if s.owner || s.due}<span class="small muted">{s.owner}{s.owner && s.due ? ' · ' : ''}{s.due ? `lest sa ${shortDay(s.due)}` : ''}</span>{/if}</span>
            <span class="pill {s.status === 'ready' ? 'ok' : s.status === 'done' ? 'meta' : s.status === 'draft' ? 'warn' : ''}">{STATUS_NAMES[s.status]}</span>
          </button>
        {:else}
          <p class="muted small">Xejn ippjanat.</p>
        {/each}
        <button class="link small" type="button" onclick={() => newSlot()}>+ Ippjana post għal dan il-jum</button>
      </div>
      <div class="sec">
        <div class="sec-h">Kampanji</div>
        {#each currentCampaigns as c (c.id)}
          <div class="camp-row" class:on={cal.campaign === c.id}>
            <button class="ev" type="button" onclick={() => openCampaign(c)}>
              <span class="bar" style="background: {c.color}"></span>
              <span class="ev-t"><b>{c.name}</b><span class="mono muted">{shortDay(c.from)} – {shortDay(c.to)}{c.from <= todayStr ? ' · għaddejja' : ''}</span></span>
            </button>
            <button class="btn ghost sm" type="button" aria-pressed={cal.campaign === c.id} title="Uri biss din il-kampanja" onclick={() => toggleFilter(c.id)}>{cal.campaign === c.id ? 'Kollox' : 'Biss'}</button>
          </div>
        {:else}
          <p class="muted small">L-ebda kampanja għaddejja jew li ġejja.</p>
        {/each}
        {#if pastCampaigns.length}
          <button class="link small" type="button" onclick={() => (showPast = !showPast)}>{showPast ? 'Aħbi' : 'Uri'} dawk li għaddew ({pastCampaigns.length})</button>
          {#if showPast}{#each pastCampaigns as c (c.id)}
            <button class="ev past" type="button" onclick={() => openCampaign(c)}><span class="bar" style="background: {c.color}"></span><span class="ev-t"><b>{c.name}</b><span class="mono muted">{shortDay(c.from)} – {shortDay(c.to)} {c.to.slice(0, 4)}</span></span></button>
          {/each}{/if}
        {/if}
        <button class="link small" type="button" onclick={() => newCampaign()}>+ Kampanja ġdida</button>
      </div>
      <div class="sec labels">
        <div class="sec-h">Labels</div>
        {#each cal.labels as l (l.name)}
          <div class="lab">
            <input type="checkbox" checked={l.visible !== false} aria-label="Uri {l.name}" onchange={(e) => editLabels((all) => all.map((x) => (x.name === l.name ? { ...x, visible: e.currentTarget.checked } : x)))} />
            <input type="color" value={l.color} aria-label="Kulur ta' {l.name}" onchange={(e) => editLabels((all) => all.map((x) => (x.name === l.name ? { ...x, color: e.currentTarget.value } : x)))} />
            <span class="truncate">{l.name}</span>
            <button class="x" type="button" aria-label="Neħħi t-label {l.name}" onclick={() => deleting(`It-label "${l.name}" tneħħiet. L-avvenimenti jibqgħu bla label.`, () => editLabels((all) => all.filter((x) => x.name !== l.name)))}><Icon name="x" size={12} /></button>
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
  .ev .bar.dotted { background: none; border-left: 3px dotted; width: 0; }
  .ev.past { opacity: .6; }
  .camp-row { display: flex; align-items: center; gap: 4px; border-radius: 8px; }
  .camp-row.on { background: var(--accent-soft); }
  .camp-row .ev { flex: 1; min-width: 0; }
  .cchip { all: unset; display: inline-block; margin: 4px 4px 0 0; padding: 1px 8px; border-radius: 9px; font-size: 11px; font-weight: 600; cursor: pointer; background: color-mix(in srgb, var(--c) 22%, transparent); border-left: 3px solid var(--c); }
  .gapnote { margin-top: 6px; }
  .filter { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 13px; }
  .filter .link { margin-left: auto; }
  .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .camp { max-width: 180px; border-left: 4px solid var(--c); }
</style>
