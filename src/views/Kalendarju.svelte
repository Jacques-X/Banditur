<script>
  import { onMount, untrack } from 'svelte';
  import luxonPlugin from '@fullcalendar/luxon3';
  import { maltaInstant, maltaWall } from '../lib/malta-time.js';
  import { useEvent, eventWork, saveProject } from '../lib/projects.svelte.js';
  import { Calendar } from '@fullcalendar/core';
  import dayGridPlugin from '@fullcalendar/daygrid';
  import timeGridPlugin from '@fullcalendar/timegrid';
  import listPlugin from '@fullcalendar/list';
  import interactionPlugin from '@fullcalendar/interaction';
  import Icon from '../components/Icon.svelte';
  import { app, ls, toast, confirm, go, configured } from '../lib/app.svelte.js';
  import { api } from '../lib/api.js';
  import { isMock, openUrl } from '../lib/tauri.js';
  import { statusOf } from '../lib/queue.svelte.js';
  import { DAYS_LONG, MONTHS, hhmm, sameDay, addDays, addHours, toLocalInput, toDateInput } from '../lib/format.js';
  import { platformById } from '../platforms.js';
  import { CONFIRM } from '../strings.js';
  import { applyState, openQueued, saveDraft, post } from './skeda/composer.svelte.js';

  let { active } = $props();

  // ── Labels (colour + show/hide), stored on this computer ──────────────────
  const LABEL_KEY = 'banditur_calendar_labels';
  const NONE = '__unlabeled';
  const DELETED = '__deleted';
  function loadLabels() {
    const defaults = {
      [NONE]: { name: 'Bla label', color: '#7B808A', visible: true, system: true },
      Festa: { name: 'Festa', color: '#C2410C', visible: true },
      Quddiesa: { name: 'Quddiesa', color: '#0F766E', visible: true },
      Prova: { name: 'Prova', color: '#6D28D9', visible: true },
    };
    const saved = ls.json(LABEL_KEY, {});
    const deleted = new Set(Array.isArray(saved[DELETED]) ? saved[DELETED] : []);
    const out = { ...defaults };
    for (const k of deleted) if (k !== NONE) delete out[k];
    for (const [k, v] of Object.entries(saved)) if (k !== DELETED && !deleted.has(k)) out[k] = { ...out[k], ...v };
    return { labels: out, deleted };
  }
  const initial = loadLabels();
  let labels = $state(initial.labels);
  let deletedLabels = initial.deleted;
  function saveLabels() {
    ls.set(LABEL_KEY, JSON.stringify({ ...$state.snapshot(labels), [DELETED]: [...deletedLabels] }));
    cal?.refetchEvents();
  }
  const labelOf = l => labels[String(l || '').trim()] || labels[NONE];
  const visible = l => labelOf(l).visible !== false;
  function ensureLabel(l) {
    const name = String(l || '').trim();
    if (!name || deletedLabels.has(name) || labels[name]) return;
    labels[name] = { name, color: '#3355D1', visible: true };
  }
  let newLabel = $state({ name: '', color: '#3355D1' });

  // ── Calendar ──────────────────────────────────────────────────────────────
  let el;
  let cal = null;
  let title = $state('');
  let view = $state(ls.get('banditur_cal_view', 'dayGridMonth'));
  let status = $state(null);       // { tone, msg }
  let events = $state([]);         // raw events of the visible range
  let day = $state(new Date(maltaWall()));
  let showPosts=$state(ls.get('banditur_cal_posts','1')==='1');
  let dayPosts = $state([]);
  let dayPostsState = $state('');
  let inspector = $state(null);    // { mode: create|edit, id, title, label, allDay, start, end, location, description, htmlLink, recurringEventId }
  let saving = $state(false);

  const VIEWS = [['dayGridMonth', 'Xahar'], ['timeGridWeek', 'Ġimgħa'], ['timeGridDay', 'Jum'], ['listMonth', 'Lista']];
  const canCall = () => configured() || isMock();

  async function fetchEvents(info, ok, fail) {
    if (!canCall()) { status = { tone: 'error', msg: 'Il-kalendarju jeħtieġ il-backend. Iftaħ is-Settings.' }; ok([]); return; }
    try {
      const list = await api('/api/calendar', { query: { start: info.startStr, end: info.endStr } });
      list.forEach(e => ensureLabel(e.extendedProps?.label));
      events = list;
      status = null;
      const posts=[];
      if(showPosts) {
        let page=1,total=1;
        while(posts.length<total) {
          const r=await api('/api/history',{query:{from:info.startStr,to:info.endStr,limit:100,page,profile_id:app.profileId,ascending:true}});
          posts.push(...(r.posts || []));total=r.total || 0;if(!r.posts?.length) break;page++;
        }
      }
      ok([...list.filter(e => visible(e.extendedProps?.label)).map(tint),...posts.map(p=>({id:`post:${p.id}`,title:`${p.platforms.join('/').toUpperCase()} · ${(p.caption || 'Post').split('\n')[0]}`,start:p.scheduled_time,durationEditable:false,editable:['pending','fb_native'].includes(p.status),backgroundColor:statusOf(p).tone==='danger'?'#b93838':'#596dbb',extendedProps:{post:p}}))]);
    } catch (e) {
      status = { tone: 'error', msg: `Ma stajniex naqraw il-kalendarju. ${e.message}` };
      fail(e);
    }
  }
  function tint(e) {
    const c = labelOf(e.extendedProps?.label).color;
    return { ...e, backgroundColor: c, borderColor: c };
  }

  onMount(() => {
    cal = new Calendar(el, {
      timeZone:'Europe/Malta',
      plugins: [luxonPlugin,interactionPlugin, dayGridPlugin, timeGridPlugin, listPlugin],
      initialView: VIEWS.some(([v]) => v === view) ? view : 'dayGridMonth',
      headerToolbar: false,
      firstDay: 1,
      height: '100%',
      nowIndicator: true,
      editable: true,
      selectable: true,
      eventResizableFromStart: true,
      dayMaxEvents: 3,
      moreLinkClick: 'popover',
      moreLinkText: n => `+${n} oħra`,
      eventOrder: 'allDay,start,title',
      slotMinTime: '06:00:00',
      slotMaxTime: '24:00:00',
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      dayHeaderContent:arg=>{const d=new Date(maltaWall(arg.date));return view==='dayGridMonth'?['Ħad','Tne','Tli','Erb','Ħam','Ġim','Sib'][d.getDay()]:`${['Ħad','Tne','Tli','Erb','Ħam','Ġim','Sib'][d.getDay()]} ${d.getDate()}`;},
      noEventsContent: 'L-ebda avveniment f\'dan il-perijodu.',
      allDayText: 'Kollu',
      events: fetchEvents,
      datesSet: info => {
        view = info.view.type;
        ls.set('banditur_cal_view', view);
        const mid = new Date(maltaWall(new Date((info.start.getTime()+info.end.getTime())/2))), first=new Date(maltaWall(info.start));
        title = view === 'timeGridDay' ? `${first.getDate()} ta' ${MONTHS[first.getMonth()]} ${first.getFullYear()}` : `${MONTHS[mid.getMonth()]} ${mid.getFullYear()}`;
      },
      dayCellClassNames: info => (maltaWall(info.date).slice(0,10)===toDateInput(day) ? ['is-picked'] : []),
      eventClassNames: info => (info.event.extendedProps?.recurringEventId ? ['is-recurring'] : []),
      dateClick: info => { day = new Date(info.dateStr.slice(0,10)+'T12:00:00'); inspector = null; cal.render(); },
      select: info => { day = new Date(maltaWall(info.start)); openCreate(info.start, info.allDay, info.end); cal.unselect(); },
      eventClick: async info => { info.jsEvent.preventDefault(); const p=info.event.extendedProps.post;if(p) {if(await openQueued(p,!['pending','fb_native'].includes(p.status))) go('skeda');} else openEdit(info.event); },
      eventDrop: info => move(info),
      eventResize: info => move(info),
    });
    cal.render();
    return () => cal?.destroy();
  });

  // FullCalendar measures itself; give it a nudge when the tab becomes visible.
  $effect(() => { if (active && cal) { untrack(() => { cal.updateSize(); cal.refetchEvents(); }); } });
  $effect(() => { if (active) { app.profileId; day; untrack(loadDayPosts); } });
  $effect(()=>{showPosts;app.profileId;if(cal) untrack(()=>cal.refetchEvents());});

  const dayEvents = $derived(events
    .filter(e => visible(e.extendedProps?.label) && occursOn(e, day))
    .sort((a, b) => (a.allDay === b.allDay ? new Date(a.start) - new Date(b.start) : a.allDay ? -1 : 1)));
  function occursOn(e, d) {
    const s = new Date(e.start);
    if (!e.allDay) return maltaWall(s).slice(0,10)===toDateInput(d);
    const key=toDateInput(d), start=String(e.start).slice(0,10);
    const end=e.end ? String(e.end).slice(0,10) : new Date(Date.parse(start+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    return key>=start && key<end;
  }

  let postsToken = 0;
  async function loadDayPosts() {
    if (!canCall()) { dayPosts = []; dayPostsState = ''; return; }
    const my = ++postsToken;
    const d0 = new Date(day); d0.setHours(0, 0, 0, 0);
    const d1 = addDays(d0, 1);
    dayPostsState = 'loading';
    try {
      const r = await api('/api/history', { query: { limit: 100, status: 'all', profile_id: app.profileId, from: maltaInstant(toDateInput(d0)+'T00:00'), to: maltaInstant(toDateInput(d1)+'T00:00') } });
      if (my !== postsToken) return;
      dayPosts = (r.posts || []).filter(p => p.scheduled_time && maltaWall(p.scheduled_time).slice(0,10)===toDateInput(d0))
        .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
      dayPostsState = '';
    } catch (e) {
      if (my === postsToken) dayPostsState = e.message;
    }
  }

  // ── Event editing ─────────────────────────────────────────────────────────
  function openCreate(start, allDay, end) {
    inspector = {
      mode: 'create', id: null, title: '', label: '', allDay: !!allDay, location: '', description: '', htmlLink: '', recurringEventId: null,
      start: allDay ? maltaWall(start).slice(0,10) : toLocalInput(start),
      end: allDay ? maltaWall(end || addDays(start,1)).slice(0,10) : toLocalInput(end && end > start ? end : addHours(start, 1)),
    };
  }
  function openEdit(e) {
    const s = e.start, en = e.end || (e.allDay ? addDays(s, 1) : addHours(s, 1));
    day = new Date(maltaWall(s));
    inspector = {
      mode: 'edit', id: e.id, title: e.title, label: e.extendedProps?.label || '', allDay: e.allDay,
      location: e.extendedProps?.location || '', description: e.extendedProps?.description || '',
      htmlLink: e.extendedProps?.htmlLink || '', recurringEventId: e.extendedProps?.recurringEventId || null,
      start: e.allDay ? maltaWall(s).slice(0,10) : toLocalInput(s), end: e.allDay ? maltaWall(en).slice(0,10) : toLocalInput(en),
    };
    if (inspector.recurringEventId) toast('Dan l-avveniment jirrepeti. Biex tbiddlu, iftħu f\'Google Calendar.', 'info');
  }
  function toggleAllDay(on) {
    const date=inspector.start.slice(0,10);
    inspector.allDay = on;
    inspector.start = on ? date : date+'T09:00';
    inspector.end = on ? new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10) : date+'T10:00';
  }
  function payload() {
    const i = inspector;
    if (!i.title.trim()) throw new Error('It-titlu huwa meħtieġ.');
    const base = { title: i.title.trim(), label: i.label, location: i.location.trim(), description: i.description.trim(), allDay: i.allDay };
    if (i.allDay) {
      if (!i.start || !i.end || i.end <= i.start) throw new Error('Agħżel dati validi (it-tmiem wara l-bidu).');
      return { ...base, start: i.start, end: i.end };
    }
    if (!i.start || !i.end || new Date(i.end) <= new Date(i.start)) throw new Error('Agħżel ħinijiet validi (it-tmiem wara l-bidu).');
    return { ...base, start: maltaInstant(i.start), end: maltaInstant(i.end) };
  }
  const friendly = e => (/forbidden|403|write access/i.test(e.message) ? 'Google Calendar qed jirrifjuta l-bidla. Aqsam il-kalendarju mal-email tas-service account b\'permess li jagħmel bidliet, u erġa\' pprova.' : e.message);
  async function save() {
    saving = true;
    try {
      const body = payload();
      const edit = inspector.mode === 'edit';
      await api('/api/calendar', { method: edit ? 'PATCH' : 'POST', query: edit ? { id: inspector.id } : undefined, body });
      toast(edit ? 'Avveniment issejvjat.' : 'Avveniment miżjud.', 'ok');
      inspector = null;
      cal.refetchEvents();
    } catch (e) { toast(friendly(e), 'error'); }
    saving = false;
  }
  async function remove() {
    if (!await confirm(CONFIRM.delete_event, { yes: 'Ħassar', no: 'Żomm', danger: true })) return;
    try {
      await api('/api/calendar', { method: 'DELETE', query: { id: inspector.id } });
      toast('Avveniment imħassar.', 'ok');
      inspector = null;
      cal.refetchEvents();
    } catch (e) { toast(friendly(e), 'error'); }
  }
  async function move(info) {
    const e = info.event;
    const p=e.extendedProps.post;
    if(p) {
      try {await api(`/api/posts/${p.id}`,{method:'PATCH',body:{revision:p.revision,scheduledTime:e.start.toISOString()}});cal.refetchEvents();loadDayPosts();toast('Il-post ġie skedat mill-ġdid.','ok');}
      catch(err) {info.revert();toast(err.message,'error');}
      return;
    }
    if (e.extendedProps?.recurringEventId) {
      info.revert();
      toast('Dan huwa parti minn sensiela ripetuta. Ċaqalqu f\'Google Calendar.', 'error');
      return;
    }
    const allDay = e.allDay;
    const body = {
      title: e.title, label: e.extendedProps?.label || '', location: e.extendedProps?.location || '', description: e.extendedProps?.description || '', allDay,
      start: allDay ? maltaWall(e.start).slice(0,10) : e.start.toISOString(),
      end: allDay ? (e.end ? maltaWall(e.end).slice(0,10) : new Date(Date.parse(maltaWall(e.start).slice(0,10)+'T00:00:00Z')+86400000).toISOString().slice(0,10)) : (e.end || addHours(e.start, 1)).toISOString(),
    };
    try {
      await api('/api/calendar', { method: 'PATCH', query: { id: e.id }, body });
      toast('Avveniment aġġornat.', 'ok');
    } catch (err) {
      info.revert();
      toast(`Ma stajniex nimxu l-avveniment. ${friendly(err)}`, 'error');
    }
  }

  async function newPostForDay() {
    if(post.caption.trim() || post.media.length || post.remoteMedia.length) {try {await saveDraft();} catch(e) {toast(e.message,'error');return;}}
    const d = new Date(day); d.setHours(18, 30, 0, 0);
    applyState({ scheduledTime: toDateInput(day)+'T18:30', platforms: ['fb', 'ig'],eventId:eventWork.id }, []);
    go('skeda');
  }
  const editableLabels = $derived(Object.entries(labels).filter(([, l]) => !l.system));
</script>

<div class="cal">
  <section class="main">
    <div class="page-head">
      <h1 class="title">{title}</h1>
      <div class="nav">
        <button class="btn icon" type="button" aria-label="Ta' qabel" onclick={() => cal.prev()}><Icon name="chevronLeft" /></button>
        <button class="btn" type="button" onclick={() => { cal.today(); day = new Date(); }}>Illum</button>
        <button class="btn icon" type="button" aria-label="Li jmiss" onclick={() => cal.next()}><Icon name="chevronRight" /></button>
      </div>
      <div class="seg" role="group" aria-label="Veduta">
        {#each VIEWS as [v, label]}<button type="button" aria-pressed={view === v} onclick={() => cal.changeView(v)}>{label}</button>{/each}
      </div>
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" bind:checked={showPosts} onchange={()=>ls.set('banditur_cal_posts',showPosts?'1':'0')}/>Posts</label>
      <span class="muted small">Ħin ta’ Malta</span>
      <button class="btn icon" type="button" aria-label="Refresh" title="Refresh" onclick={() => { cal.refetchEvents(); loadDayPosts(); }}><Icon name="refresh" size={15} /></button>
      <button class="btn primary" type="button" onclick={() => { openCreate(new Date(maltaInstant(toDateInput(day)+'T19:00')),false); }}><Icon name="plus" size={15} />Avveniment</button>
    </div>
    {#if status}<div class="notice {status.tone}" role="status">{status.msg}</div>{/if}
    <div class="fc-wrap" bind:this={el}></div>
  </section>

  <aside class="side" aria-label="Il-jum magħżul">
    {#if inspector}
      {@const ro = !!inspector.recurringEventId}
      <form class="insp" onsubmit={e => { e.preventDefault(); save(); }}>
        <div class="insp-h"><h2>{inspector.mode === 'create' ? 'Avveniment ġdid' : ro ? 'Avveniment' : 'Editja l-avveniment'}</h2>
          <button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={() => (inspector = null)}><Icon name="x" /></button></div>
        {#if ro}<div class="notice info small">Dan l-avveniment jirrepeti. Bidliet isiru biss f'Google Calendar.</div>{/if}
        <div class="field"><label class="label" for="ev-title">Titlu</label><input id="ev-title" class="input" bind:value={inspector.title} disabled={ro} /></div>
        <div class="field"><label class="label" for="ev-label">Label</label>
          <select id="ev-label" class="select" bind:value={inspector.label} disabled={ro}>
            <option value="">Bla label</option>
            {#each editableLabels as [k, l]}<option value={k}>{l.name}</option>{/each}
          </select></div>
        <label class="check"><input type="checkbox" checked={inspector.allDay} disabled={ro} onchange={e => toggleAllDay(e.currentTarget.checked)} />Il-jum kollu</label>
        <div class="two">
          <div class="field"><label class="label" for="ev-s">Jibda</label><input id="ev-s" class="input" type={inspector.allDay ? 'date' : 'datetime-local'} bind:value={inspector.start} disabled={ro} /></div>
          <div class="field"><label class="label" for="ev-e">Jispiċċa</label><input id="ev-e" class="input" type={inspector.allDay ? 'date' : 'datetime-local'} bind:value={inspector.end} disabled={ro} /></div>
        </div>
        <div class="field"><label class="label" for="ev-loc">Post</label><input id="ev-loc" class="input" bind:value={inspector.location} disabled={ro} /></div>
        <div class="field"><label class="label" for="ev-desc">Noti</label><textarea id="ev-desc" class="textarea" rows="3" bind:value={inspector.description} disabled={ro}></textarea></div>
        <div class="insp-actions">
          {#if !ro}<button class="btn primary" type="submit" disabled={saving}>{saving ? '…' : 'Save'}</button>{/if}
          {#if inspector.htmlLink}<button class="btn" type="button" onclick={() => openUrl(inspector.htmlLink)}><Icon name="external" size={14} />Google Calendar</button>{/if}
          {#if inspector.mode === 'edit' && !ro}<button class="link danger" type="button" onclick={remove}>Ħassar</button>{/if}
        </div>
      </form>
    {:else}
      <div><div class="muted small">{DAYS_LONG[day.getDay()]}</div><h2 class="day">{day.getDate()} ta' {MONTHS[day.getMonth()]}</h2></div>

      <div class="sec">
        <div class="sec-h">Avvenimenti</div>
        {#each dayEvents as e (e.id)}
          <button class="ev" type="button" onclick={() => openEdit(cal.getEventById(e.id) || { ...e, start: new Date(e.start), end: e.end ? new Date(e.end) : null })}>
            <span class="bar" style="background: {labelOf(e.extendedProps?.label).color}"></span>
            <span class="ev-t"><b>{e.title || '(Bla titlu)'}</b><span class="mono muted">{e.allDay ? 'Il-jum kollu' : `${hhmm(new Date(e.start))}${e.end ? ` – ${hhmm(new Date(e.end))}` : ''}`}{e.extendedProps?.location ? ` · ${e.extendedProps.location}` : ''}{e.extendedProps?.recurringEventId ? ' · jirrepeti' : ''}</span></span>
          </button>
        {:else}
          <p class="muted small">L-ebda avveniment f'dan il-jum.</p>
        {/each}
      </div>

      <div class="sec">
        <div class="sec-h">Posts skedati <span class="muted small">· jinbidlu mill-Arkivju</span></div>
        {#if dayPostsState === 'loading' && !dayPosts.length}
          <p class="muted small">Qed jgħabbi…</p>
        {:else if dayPostsState && dayPostsState !== 'loading'}
          <p class="small" style="color: var(--danger-fg)">{dayPostsState}</p>
        {:else}
          {#each dayPosts as p (p.id)}
            {@const s = statusOf(p)}
            <div class="post"><span class="mono muted">{hhmm(new Date(p.scheduled_time))}</span><span class="truncate">{(p.caption || '').split('\n')[0] || '(mingħajr caption)'}</span><span class="pill {s.tone}">{s.label}</span></div>
          {:else}
            <p class="muted small">L-ebda post skedat.</p>
          {/each}
        {/if}
        <button class="link small" type="button" onclick={newPostForDay}>+ Skeda post għal dan il-jum</button>
      </div>

      {#if dayEvents.length}<div class="sec"><div class="sec-h">Xogħol tal-avveniment</div>{#each dayEvents as e}<button class="btn sm" type="button" onclick={async()=>{useEvent(e.id,e.title);await saveProject({id:`event-${e.id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60)}`,version:1,kind:'event',name:e.title,eventId:e.id,data:{event:e,profileId:app.profileId}});go('home');}}>{e.title} · Iftaħ ix-xogħol</button>{/each}</div>{/if}
      <div class="sec labels">
        <div class="sec-h">Labels</div>
        {#each Object.entries(labels) as [k, l] (k)}
          <div class="lab">
            <input type="checkbox" checked={l.visible !== false} aria-label="Uri {l.name}" onchange={e => { l.visible = e.currentTarget.checked; saveLabels(); }} />
            <input type="color" value={l.color} aria-label="Kulur ta' {l.name}" onchange={e => { l.color = e.currentTarget.value; saveLabels(); }} />
            <span class="truncate">{l.name}</span>
            {#if !l.system}<button class="x" type="button" aria-label="Neħħi t-label {l.name}" onclick={async () => {
              if (!await confirm(`Tneħħi t-label "${l.name}"?`, { yes: 'Neħħi', no: 'Żomm', danger: true })) return;
              delete labels[k]; deletedLabels.add(k); saveLabels(); }}><Icon name="x" size={12} /></button>{/if}
          </div>
        {/each}
        <form class="lab add" onsubmit={e => { e.preventDefault(); const n = newLabel.name.trim(); if (!n) return; deletedLabels.delete(n); labels[n] = { name: n, color: newLabel.color, visible: true }; newLabel.name = ''; saveLabels(); }}>
          <input type="color" bind:value={newLabel.color} aria-label="Kulur" />
          <input class="input" bind:value={newLabel.name} placeholder="Label ġdid" aria-label="Isem tat-label l-ġdida" />
          <button class="btn sm" type="submit">Żid</button>
        </form>
      </div>
    {/if}
  </aside>
</div>

<style>
  .cal { flex: 1; min-height: 0; display: flex; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 18px 24px 20px; }
  .title { min-width: 170px; }
  .nav { display: flex; gap: 4px; }
  .fc-wrap { flex: 1; min-height: 0; }
  .side { width: 340px; flex-shrink: 0; border-left: 1px solid var(--line); background: var(--bg-sunken); padding: 20px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
  .day { font-size: 20px; font-weight: 650; }
  .sec { display: flex; flex-direction: column; gap: 6px; }
  .sec-h { font-weight: 600; }
  .ev { display: flex; gap: 10px; text-align: left; padding: 9px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); }
  .ev:hover { border-color: var(--line-strong); }
  .bar { width: 4px; border-radius: 2px; flex-shrink: 0; }
  .ev-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .post { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .labels { padding-top: 14px; border-top: 1px solid var(--line); }
  .lab { display: flex; align-items: center; gap: 8px; }
  .lab input[type="color"] { width: 20px; height: 20px; padding: 0; border: 0; background: none; border-radius: 4px; }
  .lab .truncate { flex: 1; }
  .lab .x { border: 0; background: none; color: var(--muted); padding: 4px; border-radius: 5px; display: flex; }
  .lab .x:hover { background: var(--hover); color: var(--fg); }
  .lab.add { margin-top: 4px; }
  .lab.add .input { flex: 1; height: 28px; }
  .insp { display: flex; flex-direction: column; gap: 12px; }
  .insp-h { display: flex; align-items: center; }
  .insp-h h2 { flex: 1; }
  .two { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .insp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .insp-actions .link { margin-left: auto; }

  /* FullCalendar, re-themed */
  .fc-wrap:global(.fc) {
    --fc-border-color: var(--line);
    --fc-page-bg-color: var(--bg);
    --fc-neutral-bg-color: var(--bg-sunken);
    --fc-today-bg-color: var(--accent-soft);
    --fc-now-indicator-color: var(--danger);
    --fc-event-text-color: #fff;
    --fc-list-event-hover-bg-color: var(--hover);
    --fc-highlight-color: var(--accent-soft);
    font-size: 12px;
  }
  .fc-wrap :global(.fc-col-header-cell-cushion) { color: var(--muted); font-weight: 600; padding: 6px 4px; text-decoration: none; }
  .fc-wrap :global(.fc-daygrid-day-number) { font-family: var(--font-mono); font-size: 11px; color: var(--fg); padding: 6px 8px; text-decoration: none; }
  .fc-wrap :global(.fc-day-other .fc-daygrid-day-number) { color: var(--muted); opacity: .7; }
  .fc-wrap :global(.fc-day-today .fc-daygrid-day-number) { background: var(--accent); color: var(--on-accent); border-radius: 10px; margin: 4px; padding: 1px 6px; }
  .fc-wrap :global(.fc-daygrid-day.is-picked) { box-shadow: inset 0 0 0 2px var(--accent); }
  .fc-wrap :global(.fc-event) { border-radius: 4px; padding: 0 2px; cursor: pointer; }
  .fc-wrap :global(.fc-daygrid-dot-event) { color: var(--fg); }
  .fc-wrap :global(.fc-daygrid-dot-event:hover) { background: var(--hover); }
  .fc-wrap :global(.fc-event.is-recurring) { opacity: .9; }
  .fc-wrap :global(.fc-more-link) { color: var(--accent-fg); }
  .fc-wrap :global(.fc-timegrid-slot-label-cushion), .fc-wrap :global(.fc-timegrid-axis-cushion) { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
  .fc-wrap :global(.fc-list-day-cushion) { background: var(--bg-sunken); }
  .fc-wrap :global(.fc-popover) { background: var(--card); border-color: var(--line); box-shadow: var(--shadow-pop); }
  .fc-wrap :global(.fc-scrollgrid) { border-radius: 8px; overflow: hidden; }
</style>
