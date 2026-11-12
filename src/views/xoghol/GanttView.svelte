<script>
  // Xogħol's Gantt view: the board's cards as bars on a calendar, grouped by
  // column. Drag a bar to move it, its ends to change the start or due date;
  // ←/→ on a focused bar moves it a day (Shift: the end only). Clicking a row
  // without dates gives the card a week from that day. Exports PNG or PDF.
  // The maths lives in gantt-model.js; the export in gantt-export.js.
  import { tick, untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { ls, toast } from '../../lib/app.svelte.js';
  import { invoke, saveDialog, baseName } from '../../lib/tauri.js';
  import { board, setDates, setStepDates, addTask, addStep, isTemp } from './board.svelte.js';
  import { labelById, datesInfo, moneyInfo, budgetTotals, moneyText } from './model.js';
  import { SCALES, chartRange, ticks, barOf, xOf, dragDates, daysFor, newSpan, dayAt, ganttRows, dayNum, stepsOf, span, addDays } from './gantt-model.js';
  import { drawGantt, exportBytes } from './gantt-export.js';

  let { columns, lastId, today, title, onopen } = $props();

  const LABEL = 240;
  const SCALE_KEY = 'banditur_xoghol_scale';
  let scale = $state(SCALES[ls.get(SCALE_KEY, 'week')] ? ls.get(SCALE_KEY, 'week') : 'week');
  let scroller = $state();
  let viewW = $state(0); // the chart's visible width, so the range can fill it
  let busy = $state(false);
  const STEPS_KEY = 'banditur_xoghol_steps';
  let showSteps = $state(ls.get(STEPS_KEY, 'on') !== 'off');
  function toggleSteps() { showSteps = !showSteps; ls.set(STEPS_KEY, showSteps ? 'on' : 'off'); }

  const px = $derived(SCALES[scale].px);
  const colIds = $derived(new Set(columns.map(c => c.id)));
  const tasks = $derived(board.tasks.filter(t => colIds.has(t.column_id)));
  const rows = $derived(ganttRows(columns, tasks));
  const range = $derived(chartRange(tasks, today, scale, Math.ceil(Math.max(0, viewW - LABEL) / px)));
  const marks = $derived(ticks(range, scale, px));
  const width = $derived(range.days * px);
  const todayX = $derived(xOf(today, range, px));
  const done = $derived(columns.length > 1 ? lastId : null);
  const stepCount = $derived(tasks.reduce((n, t) => n + stepsOf(t).length, 0));

  function setScale(s) {
    scale = s;
    ls.set(SCALE_KEY, s);
  }

  // Keep today in view when the screen opens or the zoom changes, and keep the
  // chart still when the range grows to the left (a bar dragged earlier).
  let shown = { scale: '', start: '' };
  $effect(() => {
    const s = scale, start = range.start, p = px;
    if (!scroller) return;
    untrack(() => {
      if (shown.scale !== s) toToday();
      else if (shown.start !== start) scroller.scrollLeft += (dayNum(shown.start) - dayNum(start)) * p;
      shown = { scale: s, start };
    });
  });
  function toToday() {
    if (scroller) scroller.scrollLeft = Math.max(0, todayX - (scroller.clientWidth - LABEL) * 0.2);
  }

  // ── Adding from the chart: a card in a column, or a step under a card ──────────
  let addingCol = $state(null);  // column id whose "new card" box is open
  let addingStep = $state(null); // card id whose "new step" box is open
  let addText = $state('');
  const focusNode = node => { setTimeout(() => node.focus(), 0); };
  function openCard(colId) { addingStep = null; addText = ''; addingCol = colId; }
  function openStep(task) {
    addingCol = null; addText = '';
    if (!showSteps) toggleSteps();
    addingStep = task.id;
  }
  const stepWeek = task => { const s = span(task); return s ? { start_date: s[0], due_date: s[0] } : { start_date: today, due_date: today }; };
  function submitAdd(e, kind, owner, task) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); addingCol = addingStep = null; addText = ''; return; }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const text = addText.trim();
    if (!text) { addingCol = addingStep = null; return; }
    if (kind === 'card') addTask(owner, text, newSpan(today));
    else addStep(owner, text, stepWeek(task));
    addText = '';
  }

  // ── Dragging bars ────────────────────────────────────────────────────────
  let drag = $state(null); // { id, mode, x0, delta, moved }
  let dragged = false;

  // step = a checklist step's id when its small bar is being dragged
  const view = task => (drag?.id === task.id && !drag.step && drag.delta ? { ...task, ...dragDates(task, drag.mode, drag.delta) } : task);
  const stepView = (task, s) => (drag?.step === s.id && drag.id === task.id && drag.delta ? { ...s, ...dragDates(s, drag.mode, drag.delta) } : s);

  function down(e, task, step = null) {
    if (e.button !== 0 || isTemp(task.id)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { id: task.id, step: step?.id ?? null, mode: e.target.dataset.mode || 'move', x0: e.clientX, delta: 0, moved: false };
    window.addEventListener('keydown', escDrag, true);
  }
  function move(e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x0) > 3) drag.moved = true;
    drag.delta = daysFor(e.clientX - drag.x0, px);
  }
  function up(task, step = null) {
    if (!drag) return;
    const { mode, delta, moved } = drag;
    end();
    dragged = moved;
    setTimeout(() => (dragged = false), 0);
    if (moved && delta) {
      if (step) setStepDates(task.id, step.id, dragDates(step, mode, delta));
      else setDates(task.id, dragDates(task, mode, delta));
    }
  }
  function end() {
    drag = null;
    window.removeEventListener('keydown', escDrag, true);
  }
  function escDrag(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    dragged = true;
    end();
  }
  function barClick(task) {
    if (!dragged) onopen(task);
  }
  function barKey(e, task, sub = null) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const by = e.key === 'ArrowRight' ? 1 : -1;
    if (sub) setStepDates(task.id, sub.id, dragDates(sub, e.shiftKey ? 'end' : 'move', by));
    else setDates(task.id, dragDates(task, e.shiftKey ? 'end' : 'move', by));
  }
  async function place(e, task) {
    const r = e.currentTarget.getBoundingClientRect();
    setDates(task.id, newSpan(dayAt(e.clientX - r.left, range, px)));
    await tick();
    scroller?.querySelector(`[data-bar="${task.id}"]`)?.focus();
  }

  // ── Export ───────────────────────────────────────────────────────────────
  async function exportAs(format) {
    if (busy) return;
    const safe = (title || 'Xogħol').replace(/[\\/:*?"<>|]/g, '').trim() || 'Xogħol';
    let path = await saveDialog({ defaultPath: `${safe} – Gantt.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path) return;
    if (!path.toLowerCase().endsWith(`.${format}`)) path += `.${format}`;
    busy = true;
    try {
      const chart = drawGantt({ title, columns, tasks, scale, px, today, lastId, steps: showSteps });
      const bytes = await exportBytes(chart, format);
      await invoke('save_post_image', bytes, { headers: { path: encodeURIComponent(path) } });
      toast(`Issejvjat: ${baseName(path)}`, 'ok');
    } catch (err) {
      toast(`Ma setax jesporta: ${err?.message || err}`, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="gbar">
  <div class="seg" role="group" aria-label="Skala">
    {#each Object.values(SCALES) as s (s.id)}
      <button type="button" aria-pressed={scale === s.id} onclick={() => setScale(s.id)}>{s.name}</button>
    {/each}
  </div>
  <button class="btn sm" type="button" onclick={toToday}>Illum</button>
  <span class="spacer"></span>
  {#if stepCount}
    <button class="btn sm" type="button" aria-pressed={showSteps} onclick={toggleSteps} title="Show or hide the dated steps under each card">
      Steps ({stepCount})
    </button>
  {/if}
  {#if rows.undated}
    <span class="muted small">{rows.undated === 1 ? '1 kompitu' : `${rows.undated} kompiti`} bla dati — ikklikkja r-ringiela biex tpoġġih</span>
  {/if}
  <button class="btn sm" type="button" disabled={busy || !rows.dated} onclick={() => exportAs('png')}><Icon name="download" size={14} /> PNG</button>
  <button class="btn sm" type="button" disabled={busy || !rows.dated} onclick={() => exportAs('pdf')}><Icon name="download" size={14} /> PDF</button>
</div>

{#if !columns.length}
  <div class="none"><p class="muted">M’hemm l-ebda kolonna f’dan il-board.</p></div>
{:else}
  <div class="gantt" bind:this={scroller} bind:clientWidth={viewW}>
    <div class="sheet" style="width: {LABEL + width}px; --label: {LABEL}px">
      <div class="axis">
        <div class="corner">Kompitu</div>
        <div class="scale" style="width: {width}px">
          {#each marks.months as m (m.x)}<span class="month" style="left: {m.x}px; width: {m.w}px">{m.label}</span>{/each}
          {#each marks.lines as l (l.x)}{#if l.label}<span class="day" style="left: {l.x}px">{l.label}</span>{/if}{/each}
          {#if todayX >= 0 && todayX < width}<span class="tmark" style="left: {todayX + px / 2}px">Illum</span>{/if}
        </div>
      </div>

      <div class="body">
        <div class="grid" style="width: {width}px" aria-hidden="true">
          {#each marks.weekends as w (w.x)}<span class="weekend" style="left: {w.x}px; width: {w.w}px"></span>{/each}
          {#each marks.lines as l (l.x)}<span class="line" style="left: {l.x}px"></span>{/each}
          {#each marks.months as m (m.x)}<span class="line month-line" style="left: {m.x}px"></span>{/each}
          {#if todayX >= 0 && todayX < width}<span class="today" style="left: {todayX + px / 2}px"></span>{/if}
        </div>

        {#each rows.groups as g (g.column.id)}
          {@const gt = budgetTotals(g.tasks)}
          <div class="group"><span class="ghead">{g.column.title} <em>{g.tasks.length}</em>{#if gt.count} <em class="gm" class:over={gt.left < 0}>{moneyText(gt.spent)} / {moneyText(gt.budget)}</em>{/if}
            {#if addingCol === g.column.id}
              <input class="input addbox" placeholder="Isem il-kompitu (Enter)" bind:value={addText} maxlength="200" use:focusNode
                     onkeydown={e => submitAdd(e, 'card', g.column.id)} onblur={() => { if (!addText.trim()) addingCol = null; }} />
            {:else}
              <button class="addbtn" type="button" onclick={() => openCard(g.column.id)}><Icon name="plus" size={12} /> Kompitu</button>
            {/if}
          </span></div>
          {#each g.tasks as task (task.id)}
            {@const t = view(task)}
            {@const bar = barOf(t, range, px)}
            {@const finished = task.column_id === done}
            {@const color = labelById(task.label)?.color}
            {@const money = moneyInfo(task)}
            {@const steps = showSteps ? stepsOf(task) : []}
            <div class="row" class:finished class:active={drag?.id === task.id}>
              <button class="label" type="button" title="Iftaħ" onclick={() => onopen(task)}>
                {#if color}<i style="background: {color}"></i>{/if}<span>{task.title}</span>
                {#if money}<b class="amt" class:over={money.tone === 'over'} title={money.text}>{money.text}</b>{/if}
              </button>
              <button class="stepadd" type="button" title="Add a step" aria-label="Add a step to “{task.title}”" disabled={isTemp(task.id)} onclick={() => openStep(task)}><Icon name="plus" size={12} /></button>
              <div class="track" style="width: {width}px">
                {#if bar}
                  {@const info = datesInfo(t.start_date, t.due_date, today, finished)}
                  <button type="button" class="bar" class:narrow={bar.w < 72} class:dragging={drag?.id === task.id}
                          data-bar={task.id} disabled={isTemp(task.id)}
                          style="left: {bar.x}px; width: {bar.w}px; --c: {color || 'var(--gantt-bar)'}"
                          title="{task.title} · {info?.text}"
                          aria-label="{task.title}, {info?.text}. Vleġeġ biex iċċaqlaq, Shift biex tibdel it-tmiem."
                          onpointerdown={e => down(e, task)} onpointermove={move} onpointerup={() => up(task)}
                          onpointercancel={end} onclick={() => barClick(task)} onkeydown={e => barKey(e, task)}>
                    <span class="h" data-mode="start"></span>
                    <span class="txt">{task.title}</span>
                    <span class="h" data-mode="end"></span>
                  </button>
                  {#if bar.w < 72}<span class="after" style="left: {bar.x + bar.w + 6}px">{task.title}</span>{/if}
                  {#if drag?.id === task.id && drag.delta}
                    <span class="tip" style="left: {bar.x}px">{info?.text}</span>
                  {/if}
                {:else}
                  <button type="button" class="place" aria-label="Agħti dati lil “{task.title}”" title="Ikklikkja biex tpoġġi ġimgħa minn dak il-jum"
                          onclick={e => place(e, task)}></button>
                {/if}
              </div>
            </div>
            {#each steps as s (s.id)}
              {@const sv = stepView(task, s)}
              {@const sb = barOf(sv, range, px)}
              <div class="row sub" class:finished class:active={drag?.step === s.id}>
                <button class="label" type="button" title="Iftaħ" onclick={() => onopen(task)}>
                  <span class:struck={s.done}>↳ {s.text}</span>
                  {#if moneyInfo(s)}<b class="amt" class:over={moneyInfo(s).tone === 'over'} title={moneyInfo(s).text}>{moneyInfo(s).text}</b>{/if}
                </button>
                <div class="track" style="width: {width}px">
                  <button type="button" class="bar step" class:done={s.done} class:dragging={drag?.step === s.id}
                          disabled={isTemp(task.id)} style="left: {sb.x}px; width: {sb.w}px; --c: {color || 'var(--gantt-bar)'}"
                          title="{s.text} · {datesInfo(sv.start_date, sv.due_date, today, s.done || finished)?.text}"
                          aria-label="{s.text} (pass ta’ {task.title}). Vleġeġ biex iċċaqlaq."
                          onpointerdown={e => down(e, task, s)} onpointermove={move} onpointerup={() => up(task, s)}
                          onpointercancel={end} onclick={() => barClick(task)} onkeydown={e => barKey(e, task, s)}>
                    <span class="h" data-mode="start"></span><span style="flex:1"></span><span class="h" data-mode="end"></span>
                  </button>
                  {#if sb.w < 90}<span class="after" style="left: {sb.x + sb.w + 6}px">{s.text}</span>{/if}
                </div>
              </div>
            {/each}
            {#if addingStep === task.id}
              <div class="row sub adding">
                <div class="label"><span>↳</span>
                  <input class="input addbox" placeholder="New step (Enter)" bind:value={addText} maxlength="200" use:focusNode
                         onkeydown={e => submitAdd(e, 'step', task.id, task)} onblur={() => { if (!addText.trim()) addingStep = null; }} />
                </div>
                <div class="track" style="width: {width}px"></div>
              </div>
            {/if}
          {/each}
          {#if !g.tasks.length}<div class="row sub empty"><div class="label"><span class="muted">L-ebda kompitu hawn</span></div><div class="track" style="width: {width}px"></div></div>{/if}
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .gbar { display: flex; align-items: center; gap: 8px; padding: 0 24px 10px; flex-wrap: wrap; }
  .gbar .seg > button { padding: 4px 12px; }
  .none { flex: 1; padding: 24px; }
  .gantt {
    --gantt-bar: #5B6B82;
    flex: 1; min-height: 0; overflow: auto; margin: 0 24px 24px;
    border: 1px solid var(--line-soft); border-radius: 12px; background: var(--card);
  }
  .sheet { position: relative; min-height: 100%; }
  .axis { position: sticky; top: 0; z-index: 5; display: flex; height: 46px; background: var(--card); border-bottom: 1px solid var(--line); }
  .corner {
    position: sticky; left: 0; z-index: 6; flex: none; width: var(--label); background: var(--card);
    border-right: 1px solid var(--line); display: flex; align-items: flex-end; padding: 0 12px 7px;
    font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em;
  }
  .scale { position: relative; flex: none; }
  .month {
    position: absolute; top: 0; height: 24px; line-height: 24px; padding: 0 8px; font-size: 12px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 1px solid var(--line); color: var(--fg);
  }
  .day { position: absolute; top: 26px; padding-left: 4px; font-size: 11px; color: var(--muted); }
  .tmark {
    position: absolute; top: 26px; transform: translateX(-50%); font-size: 10px; font-weight: 700;
    background: var(--danger, #D9483B); color: #fff; border-radius: 4px; padding: 1px 5px;
  }
  .body { position: relative; }
  .grid { position: absolute; top: 0; bottom: 0; left: var(--label); pointer-events: none; z-index: 0; }
  .weekend { position: absolute; top: 0; bottom: 0; background: var(--bg-sunken); opacity: .7; }
  .line { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-soft); }
  .month-line { background: var(--line); }
  .today { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--danger, #D9483B); opacity: .8; }

  .group {
    position: relative; z-index: 2; display: flex; align-items: center; gap: 8px; height: 30px;
    background: color-mix(in srgb, var(--bg-sunken) 85%, transparent); border-bottom: 1px solid var(--line-soft);
  }
  .group span {
    position: sticky; left: 0; padding-left: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: var(--fg-2); white-space: nowrap;
  }
  .group em { margin-left: 6px; font-style: normal; color: var(--muted); font-weight: 600; }
  .row { position: relative; display: flex; height: 36px; border-bottom: 1px solid var(--line-soft); }
  .label {
    position: sticky; left: 0; z-index: 3; flex: none; width: var(--label); display: flex; align-items: center; gap: 8px;
    border: 0; border-right: 1px solid var(--line); background: var(--card); color: var(--fg); padding: 0 12px;
    text-align: left; font-size: 13px; min-width: 0;
  }
  .label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label i { flex: none; width: 8px; height: 8px; border-radius: 50%; }
  .label:hover { background: var(--hover); }
  .row.finished .label span { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--line-strong); }
  .track { position: relative; flex: none; z-index: 1; }
  .row.active { z-index: 4; }
  .bar {
    position: absolute; top: 7px; height: 22px; display: flex; align-items: center; padding: 0; border: 0;
    border-radius: 6px; background: var(--c); color: #fff; font-size: 11.5px; font-weight: 600; cursor: grab;
    box-shadow: 0 1px 2px rgba(16, 24, 40, .18); touch-action: none; min-width: 6px;
  }
  .bar:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .bar.dragging { cursor: grabbing; box-shadow: 0 6px 16px rgba(16, 24, 40, .25); z-index: 2; }
  .row.finished .bar { opacity: .45; }
  .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; padding: 0 2px; pointer-events: none; }
  .bar.narrow .txt { visibility: hidden; }
  .h { flex: none; align-self: stretch; width: 7px; cursor: ew-resize; border-radius: 6px; }
  .bar:hover .h { background: rgba(255, 255, 255, .28); }
  .after { position: absolute; top: 0; height: 36px; line-height: 36px; font-size: 12px; color: var(--muted); white-space: nowrap; pointer-events: none; }
  .group { justify-content: flex-start; }
  .ghead { display: inline-flex; align-items: center; gap: 6px; }
  .addbtn { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--line-strong); background: var(--card); color: var(--fg-2); border-radius: 6px; padding: 2px 8px; font-size: 11.5px; font-weight: 600; }
  .addbtn:hover { background: var(--hover); }
  .addbox { height: 24px; width: 220px; font-size: 12px; }
  .row.adding .label { gap: 4px; }
  .row.adding .addbox { flex: 1; width: auto; }
  .stepadd { position: absolute; left: calc(var(--label) - 26px); top: 9px; z-index: 4; width: 18px; height: 18px; display: none; place-items: center; border: 0; border-radius: 4px; background: var(--bg-sunken); color: var(--fg-2); padding: 0; }
  .row:hover .stepadd, .stepadd:focus-visible { display: grid; }
  .row:not(.sub):hover .amt { visibility: hidden; }
  .amt { margin-left: auto; flex: none; font-size: 11px; font-weight: 600; color: var(--muted); }
  .amt.over, .gm.over { color: var(--danger-fg); }
  .gm { color: var(--fg-2); }
  .row.sub { height: 26px; background: color-mix(in srgb, var(--bg-sunken) 35%, transparent); }
  .row.sub .label { font-size: 12px; color: var(--fg-2); padding-left: 24px; background: var(--card); }
  .struck { text-decoration: line-through; color: var(--muted); }
  .bar.step { top: 7px; height: 12px; border-radius: 4px; opacity: .8; background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.22) 0 4px, transparent 4px 8px); }
  .bar.step.done { opacity: .4; background-image: none; }
  .row.sub .after { height: 26px; line-height: 26px; font-size: 11.5px; }
  .tip {
    position: absolute; top: -2px; transform: translateY(-100%); z-index: 4; white-space: nowrap; pointer-events: none;
    background: var(--fg); color: var(--card); font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 5px;
  }
  .row:first-of-type .tip { transform: none; top: 31px; }
  .place { position: absolute; inset: 0; border: 0; background: transparent; cursor: copy; }
  .place:hover { background: repeating-linear-gradient(135deg, transparent 0 8px, var(--accent-soft) 8px 10px); }
  :global(body.xg-dragging) .bar { cursor: grabbing; }
</style>
