<script>
  // Xogħol — the committee's shared to-do boards. Each profile has any number of
  // boards the users create (e.g. Videos, Elementi), each with columns of cards;
  // drag a card (or Alt+arrows) to move it. Stored on the backend (/api/tasks);
  // other people's changes show up within 30 seconds.
  import { onMount, untrack, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { app, confirm, openSettings } from '../lib/app.svelte.js';
  import {
    board, load, addTask, moveTask, toggleItem, addColumn, deleteColumn, isTemp,
    addBoard, deleteBoard, selectBoard, rename, shift,
  } from './xoghol/board.svelte.js';
  import { sortedColumns, cardsIn, dropIndex, keyboardTarget, maltaToday, TASK_LIMITS } from './xoghol/model.js';
  import TaskCard from './xoghol/TaskCard.svelte';
  import TaskDialog from './xoghol/TaskDialog.svelte';

  let { active } = $props();

  const POLL_MS = 30000;
  let today = $state(maltaToday());
  let editing = $state(null);   // task open in the dialog
  let adding = $state(null);    // column id with the quick-add box open
  let addText = $state('');
  let renaming = $state(null);  // column id being renamed
  let renameText = $state('');
  let newColumn = $state(null); // '' while the "+ Kolonna" box is open
  let newBoard = $state(null);  // '' while the "+ Board" box is open
  let firstBoard = $state('');  // the empty-state name field
  let renamingBoard = $state(null);
  let boardMenu = $state(false);
  let boardEl = $state();
  let tabsEl = $state();

  const boards = $derived(sortedColumns(board.boards));
  const current = $derived(boards.find(b => b.id === board.boardId));
  const columns = $derived(sortedColumns(board.columns.filter(c => c.board_id === board.boardId)));
  const lastId = $derived(columns.at(-1)?.id);
  const colIds = $derived(new Set(columns.map(c => c.id)));
  const openCount = $derived(board.tasks.filter(t => colIds.has(t.column_id) && t.column_id !== lastId).length);

  $effect(() => {
    if (!active) return;
    app.profileId;
    untrack(() => load(app.profileId, { quiet: board.loaded && board.profileId === app.profileId }));
  });
  onMount(() => {
    const poll = () => {
      today = maltaToday();
      if (active && document.visibilityState === 'visible' && board.profileId) load(board.profileId, { quiet: true });
    };
    const timer = setInterval(poll, POLL_MS);
    window.addEventListener('focus', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); };
  });

  // ── Drag & drop (pointer events: the window's file-drop handling gets in the
  //    way of HTML5 drag-and-drop in the Tauri webview) ─────────────────────
  let drag = $state(null);  // { task, x, y, offX, offY, w, h, colId, index, from, fromIndex }
  let press = null;
  let suppressClick = false;
  let raf = 0;

  function down(e, task, el) {
    if (e.button !== 0 || isTemp(task.id) || e.target.closest('input, label, button, a, textarea, select')) return;
    press = { task, el, x0: e.clientX, y0: e.clientY };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
  function move(e) {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < 5) return;
      const r = press.el.getBoundingClientRect();
      const own = cardsIn(board.tasks, press.task.column_id);
      const fromIndex = own.findIndex(t => t.id === press.task.id);
      drag = {
        task: press.task, x: e.clientX, y: e.clientY, offX: press.x0 - r.left, offY: press.y0 - r.top,
        w: r.width, h: r.height, colId: press.task.column_id, index: fromIndex, from: press.task.column_id, fromIndex,
      };
      board.dragging = true;
      document.body.classList.add('xg-dragging');
      window.addEventListener('keydown', escDrag, true);
      raf = requestAnimationFrame(frame);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    locate();
  }
  function locate() {
    if (!drag || !boardEl) return;
    const cols = [...boardEl.querySelectorAll('[data-col]')];
    const hit = cols.find(c => { const r = c.getBoundingClientRect(); return drag.x >= r.left && drag.x <= r.right; });
    if (!hit) return;
    const boxes = [...hit.querySelectorAll('[data-card]')]
      .filter(c => c.dataset.card !== drag.task.id)
      .map(c => { const r = c.getBoundingClientRect(); return { top: r.top, height: r.height }; });
    drag.colId = hit.dataset.col;
    drag.index = dropIndex(boxes, drag.y);
  }
  // Scroll the board sideways, and the column under the pointer up/down, near the edges.
  function frame() {
    if (!drag) return;
    const edge = 60, speed = 14;
    const b = boardEl?.getBoundingClientRect();
    if (b) {
      if (drag.x < b.left + edge) boardEl.scrollLeft -= speed;
      else if (drag.x > b.right - edge) boardEl.scrollLeft += speed;
    }
    const list = boardEl?.querySelector(`[data-col="${drag.colId}"] .cards`);
    const l = list?.getBoundingClientRect();
    if (l) {
      if (drag.y < l.top + edge) list.scrollTop -= speed;
      else if (drag.y > l.bottom - edge) list.scrollTop += speed;
    }
    locate();
    raf = requestAnimationFrame(frame);
  }
  function finish(commit) {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escDrag, true);
    cancelAnimationFrame(raf);
    if (drag) {
      const { task, colId, index, from, fromIndex } = drag;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      if (commit && !(colId === from && index === fromIndex)) moveTask(task.id, colId, index);
      document.body.classList.remove('xg-dragging');
    }
    drag = null;
    press = null;
    board.dragging = false;
  }
  const up = () => finish(true);
  const cancel = () => finish(false);
  function escDrag(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } }

  // ── Card actions ─────────────────────────────────────────────────────────
  function open(task) {
    if (suppressClick || isTemp(task.id)) return;
    editing = task;
  }
  async function cardKey(e, task) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(task); return; }
    if (!e.altKey || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const to = keyboardTarget(columns, board.tasks, task.id, e.key);
    if (!to || isTemp(task.id)) return;
    moveTask(task.id, to.columnId, to.index);
    await tick();
    boardEl?.querySelector(`[data-card="${task.id}"]`)?.focus();
  }

  async function startAdd(colId) {
    adding = colId;
    addText = '';
    await tick();
    boardEl?.querySelector(`[data-col="${colId}"] .quick textarea`)?.focus();
  }
  function submitAdd(keepOpen = true) {
    const text = addText.trim();
    if (text) addTask(adding, text);
    addText = '';
    if (!keepOpen || !text) adding = null;
  }
  function addKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAdd(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); adding = null; }
  }

  // ── Column actions ───────────────────────────────────────────────────────
  async function startRename(col) {
    if (isTemp(col.id)) return;
    renaming = col.id;
    renameText = col.title;
    await tick();
    boardEl?.querySelector(`[data-col="${col.id}"] .rename`)?.select();
  }
  function submitRename() {
    if (renaming) rename('column', renaming, renameText);
    renaming = null;
  }
  async function removeColumn(col) {
    if (cardsIn(board.tasks, col.id).length) return;
    if (await confirm(`Tħassar il-kolonna “${col.title}”?`, { yes: 'Ħassar', no: 'Le', danger: true })) deleteColumn(col.id);
  }
  async function startColumn() {
    newColumn = '';
    await tick();
    boardEl?.querySelector('.newcol input')?.focus();
  }
  function submitColumn() {
    if (newColumn?.trim()) addColumn(newColumn);
    newColumn = null;
  }

  // ── Boards ───────────────────────────────────────────────────────────────
  async function startBoard() {
    newBoard = '';
    await tick();
    tabsEl?.querySelector('.newboard')?.focus();
  }
  function submitBoard() {
    if (newBoard?.trim()) addBoard(newBoard);
    newBoard = null;
  }
  async function startRenameBoard() {
    boardMenu = false;
    if (!current || isTemp(current.id)) return;
    renamingBoard = current.id;
    renameText = current.title;
    await tick();
    tabsEl?.querySelector('.tabrename')?.select();
  }
  function submitRenameBoard() {
    if (renamingBoard) rename('board', renamingBoard, renameText);
    renamingBoard = null;
  }
  async function removeBoard() {
    boardMenu = false;
    if (!current) return;
    const n = board.tasks.filter(t => colIds.has(t.column_id)).length;
    const what = n ? ` u ${n === 1 ? 'l-kompitu li fih' : `il-${n} kompiti li fih`}` : '';
    if (await confirm(`Tħassar il-board “${current.title}”${what}? Jitħassar għal kulħadd.`, { yes: 'Ħassar', no: 'Le', danger: true }))
      deleteBoard(current.id);
  }
  function tabKey(e, i) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = boards[(i + (e.key === 'ArrowRight' ? 1 : -1) + boards.length) % boards.length];
    if (!next) return;
    selectBoard(next.id);
    tick().then(() => tabsEl?.querySelector(`[data-board="${next.id}"]`)?.focus());
  }
  function outside(e) { if (boardMenu && !e.target.closest('.bmenu-wrap')) boardMenu = false; }

  const visible = col => cardsIn(board.tasks, col.id).filter(t => !drag || t.id !== drag.task.id);
</script>

<svelte:window onclick={outside} />

<div class="xg">
  <div class="page-head head">
    <h1>Xogħol</h1>
    {#if board.loaded && current}<span class="muted">{openCount === 1 ? '1 kompitu miftuħ' : `${openCount} kompiti miftuħa`}</span>{/if}
    <span class="spacer"></span>
    {#if boards.length}<span class="muted small hint">Ikklikkja biex teditja · kaxkar jew ⌥ + vleġeġ biex iċċaqlaq</span>{/if}
    <button class="btn icon" type="button" aria-label="Aġġorna" title="Aġġorna" disabled={board.loading}
            onclick={() => load(app.profileId, { quiet: true, force: true })}><Icon name="refresh" size={15} /></button>
  </div>

  {#if board.loaded && boards.length}
    <div class="boards" role="tablist" aria-label="Boards" bind:this={tabsEl}>
      {#each boards as b, i (b.id)}
        {#if renamingBoard === b.id}
          <input class="input tabrename" bind:value={renameText} maxlength={TASK_LIMITS.column} aria-label="Isem il-board"
                 onblur={submitRenameBoard}
                 onkeydown={e => { if (e.key === 'Enter') submitRenameBoard(); if (e.key === 'Escape') { e.stopPropagation(); renamingBoard = null; } }} />
        {:else}
          <button type="button" role="tab" class="btab" data-board={b.id} aria-selected={b.id === board.boardId}
                  tabindex={b.id === board.boardId ? 0 : -1}
                  onclick={() => selectBoard(b.id)} ondblclick={() => { selectBoard(b.id); startRenameBoard(); }}
                  onkeydown={e => tabKey(e, i)}>{b.title}</button>
        {/if}
        {#if b.id === board.boardId && renamingBoard !== b.id}
          <span class="bmenu-wrap">
            <button class="btn ghost icon sm" type="button" aria-label="Għażliet tal-board" title="Għażliet tal-board"
                    aria-haspopup="menu" aria-expanded={boardMenu} disabled={isTemp(b.id)} onclick={() => (boardMenu = !boardMenu)}><Icon name="chevron" size={13} /></button>
            {#if boardMenu}
              <div class="bmenu" role="menu" tabindex="-1" onkeydown={e => { if (e.key === 'Escape') { e.stopPropagation(); boardMenu = false; } }}>
                <button role="menuitem" type="button" onclick={startRenameBoard}><Icon name="pen" size={14} /> Ibdel l-isem</button>
                <button role="menuitem" type="button" disabled={i === 0} onclick={() => { boardMenu = false; shift('board', b.id, -1); }}><Icon name="chevronLeft" size={14} /> Ċaqlaq lejn ix-xellug</button>
                <button role="menuitem" type="button" disabled={i === boards.length - 1} onclick={() => { boardMenu = false; shift('board', b.id, 1); }}><Icon name="chevronRight" size={14} /> Ċaqlaq lejn il-lemin</button>
                <button role="menuitem" type="button" class="danger" onclick={removeBoard}><Icon name="trash" size={14} /> Ħassar il-board</button>
              </div>
            {/if}
          </span>
        {/if}
      {/each}
      {#if boards.length < TASK_LIMITS.boards}
        {#if newBoard !== null}
          <input class="input newboard" placeholder="Isem il-board" bind:value={newBoard} maxlength={TASK_LIMITS.column}
                 onblur={submitBoard}
                 onkeydown={e => { if (e.key === 'Enter') submitBoard(); if (e.key === 'Escape') { e.stopPropagation(); newBoard = null; } }} />
        {:else}
          <button class="addtab" type="button" onclick={startBoard}><Icon name="plus" size={13} /> Board</button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if board.error && !board.loaded}
    <div class="pad">
      <div class="notice danger" role="alert">
        <div>{board.error}</div>
        <button class="link" type="button" onclick={() => load(app.profileId)}>Erġa’ pprova</button>
        <button class="link" type="button" onclick={() => openSettings('sistema')}>Iċċekkja l-konnessjoni</button>
      </div>
    </div>
  {:else if !board.loaded}
    <div class="empty"><p class="muted">Qed jitgħabba…</p></div>
  {:else if !boards.length}
    <div class="first">
      <div class="card firstcard">
        <h2>L-ewwel board</h2>
        <p class="muted">Agħmel board għal kull tip ta’ xogħol — per eżempju <strong>Videos</strong> jew <strong>Elementi</strong>.
          Kull board jibda b’kolonni Biex isir, Għaddej u Lest, u jinqasam ma’ kulħadd fuq dan il-profil.</p>
        <form class="field-row" onsubmit={e => { e.preventDefault(); if (firstBoard.trim()) { addBoard(firstBoard); firstBoard = ''; } }}>
          <input class="input" placeholder="Isem il-board" bind:value={firstBoard} maxlength={TASK_LIMITS.column} aria-label="Isem il-board" />
          <button class="btn primary" type="submit" disabled={!firstBoard.trim()}>Oħloq</button>
        </form>
      </div>
    </div>
  {:else if current && isTemp(current.id)}
    <div class="empty"><p class="muted">Qed jinħoloq il-board…</p></div>
  {:else}
    <div class="board" bind:this={boardEl}>
      {#each columns as col (col.id)}
        {@const list = visible(col)}
        {@const total = cardsIn(board.tasks, col.id).length}
        <section class="col" data-col={col.id} aria-label={col.title} class:target={drag?.colId === col.id}>
          <header>
            {#if renaming === col.id}
              <input class="input rename" bind:value={renameText} maxlength={TASK_LIMITS.column} aria-label="Isem il-kolonna"
                     onblur={submitRename}
                     onkeydown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { e.stopPropagation(); renaming = null; } }} />
            {:else}
              <button class="ctitle" type="button" title="Ibdel l-isem" onclick={() => startRename(col)}>{col.title}</button>
              <span class="count">{total}</span>
              <span class="spacer"></span>
              <span class="tools">
                <button class="btn ghost icon sm" type="button" aria-label="Ċaqlaq lejn ix-xellug" title="Ċaqlaq lejn ix-xellug"
                        disabled={col.id === columns[0].id} onclick={() => shift('column', col.id, -1)}><Icon name="chevronLeft" size={14} /></button>
                <button class="btn ghost icon sm" type="button" aria-label="Ċaqlaq lejn il-lemin" title="Ċaqlaq lejn il-lemin"
                        disabled={col.id === lastId} onclick={() => shift('column', col.id, 1)}><Icon name="chevronRight" size={14} /></button>
                <button class="btn ghost icon sm" type="button" aria-label="Ħassar il-kolonna"
                        title={total ? 'Ċaqlaq jew ħassar il-kompiti l-ewwel' : columns.length < 2 ? 'Board irid ikollu mill-inqas kolonna waħda' : 'Ħassar il-kolonna'}
                        disabled={!!total || columns.length < 2} onclick={() => removeColumn(col)}><Icon name="trash" size={14} /></button>
              </span>
            {/if}
          </header>

          <div class="cards">
            {#each list as task, i (task.id)}
              {#if drag?.colId === col.id && drag.index === i}<div class="drop" style="height: {drag.h}px"></div>{/if}
              <TaskCard {task} {today} finished={col.id === lastId && columns.length > 1} temp={isTemp(task.id)}
                        ondown={down} onopen={open} ontoggle={toggleItem} onkey={cardKey} />
            {/each}
            {#if drag?.colId === col.id && drag.index >= list.length}<div class="drop" style="height: {drag.h}px"></div>{/if}
            {#if !list.length && !(drag?.colId === col.id)}<p class="none">M’hemm xejn hawn.</p>{/if}
          </div>

          {#if adding === col.id}
            <div class="quick">
              <textarea class="textarea" rows="2" placeholder="X’hemm bżonn isir? (Enter)" bind:value={addText}
                        maxlength={TASK_LIMITS.title} onkeydown={addKey}></textarea>
              <div class="field-row">
                <button class="btn primary sm" type="button" onclick={() => submitAdd(true)}>Żid</button>
                <button class="btn ghost sm" type="button" onclick={() => (adding = null)}>Agħlaq</button>
              </div>
            </div>
          {:else}
            <button class="addbtn" type="button" disabled={isTemp(col.id)} onclick={() => startAdd(col.id)}><Icon name="plus" size={14} /> Żid kompitu</button>
          {/if}
        </section>
      {/each}

      {#if columns.length < TASK_LIMITS.columns}
        <div class="newcol">
          {#if newColumn !== null}
            <input class="input" placeholder="Isem il-kolonna" bind:value={newColumn} maxlength={TASK_LIMITS.column}
                   onblur={submitColumn}
                   onkeydown={e => { if (e.key === 'Enter') submitColumn(); if (e.key === 'Escape') { e.stopPropagation(); newColumn = null; } }} />
          {:else}
            <button class="addbtn" type="button" onclick={startColumn}><Icon name="plus" size={14} /> Kolonna</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if drag}
  <div class="drag-ghost" style="left: {drag.x - drag.offX}px; top: {drag.y - drag.offY}px; width: {drag.w}px">
    <TaskCard task={drag.task} {today} />
  </div>
{/if}

{#if editing}
  <TaskDialog task={editing} onclose={() => (editing = null)} />
{/if}

<style>
  .xg { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .head { padding: 18px 24px 12px; }
  .hint { margin-right: 4px; }
  .pad { padding: 0 24px; }
  .boards { display: flex; align-items: center; gap: 2px; padding: 0 24px 10px; flex-wrap: wrap; }
  .btab {
    border: 0; background: transparent; color: var(--fg-2); padding: 6px 11px; border-radius: 7px;
    font-weight: 600; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .btab:hover { background: var(--hover); color: var(--fg); }
  .btab[aria-selected="true"] { background: var(--accent-soft); color: var(--accent-fg); }
  .tabrename, .newboard { height: 30px; width: 180px; font-weight: 600; }
  .addtab { display: inline-flex; align-items: center; gap: 5px; border: 1px dashed var(--line-strong); background: transparent; color: var(--muted); padding: 5px 10px; border-radius: 7px; margin-left: 6px; font-weight: 600; }
  .addtab:hover { color: var(--fg); background: var(--hover); }
  .bmenu-wrap { position: relative; display: flex; flex: none; margin-right: 4px; }
  .bmenu-wrap > .btn { width: 24px; height: 24px; min-width: 24px; }
  .bmenu {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; min-width: 210px;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow-pop);
    padding: 5px; display: flex; flex-direction: column;
  }
  .bmenu button { display: flex; align-items: center; gap: 9px; border: 0; background: none; color: var(--fg); padding: 8px 10px; border-radius: 7px; text-align: left; }
  .bmenu button:hover:not(:disabled) { background: var(--accent-soft); }
  .bmenu button:disabled { opacity: .45; }
  .bmenu .danger { color: var(--danger-fg); }
  .first { flex: 1; display: grid; place-items: start center; padding: 48px 24px; }
  .firstcard { max-width: 460px; padding: 22px 24px; display: flex; flex-direction: column; gap: 10px; }
  .firstcard h2 { margin: 0; }
  .firstcard p { margin: 0 0 4px; line-height: 1.5; }
  .firstcard .input { flex: 1; }
  .empty { flex: 1; }
  .board {
    flex: 1; min-height: 0; display: flex; align-items: flex-start; gap: 14px;
    padding: 4px 24px 24px; overflow-x: auto; overflow-y: hidden;
  }
  .col {
    flex: 0 0 292px; max-height: 100%; display: flex; flex-direction: column;
    background: var(--bg-sunken); border: 1px solid var(--line-soft); border-radius: 12px;
    transition: border-color .12s;
  }
  .col.target { border-color: var(--accent-soft-2); }
  .col header { display: flex; align-items: center; gap: 6px; padding: 10px 8px 6px 12px; min-height: 44px; }
  .ctitle { border: 0; background: none; padding: 2px 4px; margin-left: -4px; border-radius: 5px; font-weight: 700; font-size: 13.5px; color: var(--fg); text-align: left; cursor: text; }
  .ctitle:hover { background: var(--hover); }
  .count { font-size: 12px; color: var(--muted); font-weight: 600; }
  .tools { display: flex; opacity: 0; transition: opacity .12s; }
  .col header:hover .tools, .col header:focus-within .tools { opacity: 1; }
  .tools .btn { width: 26px; height: 26px; }
  .rename { height: 30px; flex: 1; font-weight: 600; }
  .cards { flex: 1; min-height: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 2px 8px 8px; }
  .drop { flex-shrink: 0; border-radius: 10px; border: 2px dashed var(--accent); background: var(--accent-soft); opacity: .7; }
  .none { margin: 2px 4px 6px; font-size: 12px; color: var(--muted); }
  .quick { display: flex; flex-direction: column; gap: 8px; padding: 0 8px 10px; }
  .quick .textarea { font-size: 13px; }
  .addbtn {
    display: flex; align-items: center; gap: 6px; margin: 0 8px 8px; padding: 7px 8px; border: 0; border-radius: 8px;
    background: transparent; color: var(--muted); font-weight: 600; text-align: left;
  }
  .addbtn:hover:not(:disabled) { background: var(--hover); color: var(--fg); }
  .newcol { flex: 0 0 240px; }
  .newcol .addbtn { margin: 0; width: 100%; border: 1px dashed var(--line-strong); }
  .drag-ghost { position: fixed; z-index: 90; pointer-events: none; transform: rotate(2deg); filter: drop-shadow(0 10px 22px rgba(16, 24, 40, .22)); }
  :global(body.xg-dragging), :global(body.xg-dragging *) { cursor: grabbing !important; user-select: none !important; }
  @media (max-width: 1100px) { .hint { display: none; } }
</style>
