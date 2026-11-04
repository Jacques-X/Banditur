<script>
  // Edit one Xogħol card: title, colour, due date, column, checklist and notes.
  // Saves with the revision it was opened with; if someone else changed the
  // card meanwhile, it says so and lets you see theirs or save yours anyway.
  import { tick } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { confirm } from '../../lib/app.svelte.js';
  import { board, saveTask, deleteTask } from './board.svelte.js';
  import { LABELS, TASK_LIMITS, taskFields, sortedColumns, cardsIn, positionAt, itemId } from './model.js';

  let { task, onclose } = $props();

  const copy = t => ({
    title: t.title || '',
    notes: t.notes || '',
    checklist: (t.checklist || []).map(x => ({ ...x })),
    due_date: t.due_date || '',
    label: t.label || '',
    column_id: t.column_id,
  });
  // svelte-ignore state_referenced_locally
  let draft = $state(copy(task));
  // svelte-ignore state_referenced_locally
  let base = $state({ ...copy(task), revision: task.revision });
  let error = $state('');
  let saving = $state(false);
  let conflict = $state(null); // the newer card from someone else
  let newItem = $state('');
  let listEl = $state();

  // Every board's columns, so a card can also move to another board.
  const groups = $derived(sortedColumns(board.boards).map(b => ({
    board: b, columns: sortedColumns(board.columns.filter(c => c.board_id === b.id && !String(c.id).startsWith('tmp-'))),
  })).filter(g => g.columns.length));
  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(copy(base)));
  const doneCount = $derived(draft.checklist.filter(x => x.done && x.text.trim()).length);
  const itemCount = $derived(draft.checklist.filter(x => x.text.trim()).length);

  function addItem() {
    if (!newItem.trim()) return;
    if (draft.checklist.length >= TASK_LIMITS.items) { error = `Massimu ${TASK_LIMITS.items} punt.`; return; }
    draft.checklist.push({ id: itemId(), text: newItem.trim(), done: false });
    newItem = '';
  }
  async function insertAfter(i) {
    if (draft.checklist.length >= TASK_LIMITS.items) { error = `Massimu ${TASK_LIMITS.items} punt.`; return; }
    const item = { id: itemId(), text: '', done: false };
    draft.checklist.splice(i + 1, 0, item);
    await tick();
    listEl?.querySelector(`[data-item="${item.id}"]`)?.focus();
  }
  function itemKey(e, i) {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); insertAfter(i); }
    if (e.key === 'Backspace' && !draft.checklist[i].text) {
      e.preventDefault();
      draft.checklist.splice(i, 1);
      tick().then(() => listEl?.querySelectorAll('[data-item]')[Math.max(0, i - 1)]?.focus());
    }
  }

  async function save(revision = base.revision) {
    error = '';
    const body = {
      title: draft.title, notes: draft.notes, checklist: draft.checklist,
      due_date: draft.due_date || null, label: draft.label || null,
    };
    if (draft.column_id !== base.column_id) {
      const there = cardsIn(board.tasks, draft.column_id).filter(t => t.id !== task.id);
      body.column_id = draft.column_id;
      body.position = positionAt(there, there.length) ?? (there.length + 1) * 1024;
    }
    const { error: invalid } = taskFields(body, { partial: true });
    if (invalid) { error = invalid; return; }
    saving = true;
    try {
      await saveTask(task.id, body, revision);
      onclose();
    } catch (e) {
      if (e.status === 409 || e.status === 404) {
        conflict = board.tasks.find(t => t.id === task.id) || null;
        if (!conflict) error = 'Dan il-kompitu tħassar minn xi ħadd ieħor.';
      } else error = e.message;
    } finally {
      saving = false;
    }
  }
  function takeTheirs() {
    draft = copy(conflict);
    base = { ...copy(conflict), revision: conflict.revision };
    conflict = null;
  }
  async function close() {
    if (dirty && !(await confirm('Titlef il-bidliet li għamilt f’dan il-kompitu?', { yes: 'Itlaq', no: 'Ibqa’ hawn', danger: true }))) return;
    onclose();
  }
  async function remove() {
    if (!(await confirm(`Tħassar “${task.title}”? Jitħassar għal kulħadd.`, { yes: 'Ħassar', no: 'Le', danger: true }))) return;
    deleteTask(task.id);
    onclose();
  }
  // Modal focuses its first control (the ×); start on the title instead.
  const focusLater = node => { setTimeout(() => node.focus(), 0); };

  function keydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  }
</script>

<Modal title="Kompitu" width={580} onclose={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="form" onkeydown={keydown}>
    {#if conflict}
      <div class="notice warn" role="alert">
        <div class="grow">Xi ħadd ieħor biddel dan il-kompitu waqt li kont qed teditja.
          <div class="acts">
            <button class="btn sm" type="button" onclick={takeTheirs}>Ara l-verżjoni tagħhom</button>
            <button class="btn sm" type="button" onclick={() => save(conflict.revision)}>Issejvja tiegħi xorta</button>
          </div>
        </div>
      </div>
    {/if}
    {#if error}<div class="notice danger" role="alert">{error}</div>{/if}

    <label class="field">
      <span class="label">Titlu</span>
      <input class="input" bind:value={draft.title} maxlength={TASK_LIMITS.title} use:focusLater />
    </label>

    <div class="row">
      <div class="field">
        <span class="label" id="xg-label">Kulur</span>
        <div class="swatches" role="group" aria-labelledby="xg-label">
          <button type="button" class="sw none" aria-pressed={!draft.label} title="Xejn" aria-label="Xejn" onclick={() => (draft.label = '')}><Icon name="x" size={12} /></button>
          {#each LABELS as l (l.id)}
            <button type="button" class="sw" style="--c: {l.color}" aria-pressed={draft.label === l.id} title={l.name} aria-label={l.name} onclick={() => (draft.label = l.id)}></button>
          {/each}
        </div>
      </div>
      <label class="field">
        <span class="label">Sa meta</span>
        <span class="field-row">
          <input class="input" type="date" bind:value={draft.due_date} />
          {#if draft.due_date}<button class="btn ghost icon" type="button" aria-label="Neħħi d-data" title="Neħħi d-data" onclick={() => (draft.due_date = '')}><Icon name="x" size={14} /></button>{/if}
        </span>
      </label>
      <label class="field">
        <span class="label">{groups.length > 1 ? 'Board · Kolonna' : 'Kolonna'}</span>
        <select class="select" bind:value={draft.column_id}>
          {#each groups as g (g.board.id)}
            {#each g.columns as c (c.id)}
              <option value={c.id}>{groups.length > 1 ? `${g.board.title} · ${c.title}` : c.title}</option>
            {/each}
          {/each}
        </select>
      </label>
    </div>

    <div class="field">
      <span class="label">Checklist {#if itemCount}<span class="muted small">· {doneCount}/{itemCount}</span>{/if}</span>
      <ul class="list" bind:this={listEl}>
        {#each draft.checklist as item, i (item.id)}
          <li>
            <input type="checkbox" bind:checked={item.done} aria-label="Lest" />
            <input class="input item" class:done={item.done} data-item={item.id} bind:value={item.text}
                   maxlength={TASK_LIMITS.itemText} onkeydown={e => itemKey(e, i)} aria-label="Punt {i + 1}" />
            <button class="btn ghost icon" type="button" aria-label="Neħħi l-punt" title="Neħħi" onclick={() => draft.checklist.splice(i, 1)}><Icon name="x" size={14} /></button>
          </li>
        {/each}
        <li class="add">
          <Icon name="plus" size={14} />
          <input class="input item" placeholder="Żid punt (Enter)" bind:value={newItem} maxlength={TASK_LIMITS.itemText}
                 onkeydown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addItem(); } }} />
        </li>
      </ul>
    </div>

    <label class="field">
      <span class="label">Noti</span>
      <textarea class="textarea" rows="6" bind:value={draft.notes} maxlength={TASK_LIMITS.notes} placeholder="Dettalji, numri, kuntatti…"></textarea>
    </label>
  </div>

  {#snippet footer()}
    <button class="link danger del" type="button" onclick={remove}><Icon name="trash" size={14} /> Ħassar</button>
    <span class="spacer"></span>
    <button class="btn" type="button" onclick={close}>Ikkanċella</button>
    <button class="btn primary" type="button" disabled={saving || !draft.title.trim()} onclick={() => save()}>
      {saving ? 'Qed jissejvja…' : 'Issejvja'} <span class="hint">⌘↵</span>
    </button>
  {/snippet}
</Modal>

<style>
  .form { display: flex; flex-direction: column; gap: 16px; }
  .row { display: grid; grid-template-columns: auto 1fr 1fr; gap: 14px; align-items: start; }
  .swatches { display: flex; gap: 6px; height: 34px; align-items: center; }
  .sw { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; background: var(--c); padding: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
  .sw.none { background: var(--bg-sunken); color: var(--muted); display: grid; place-items: center; box-shadow: inset 0 0 0 1px var(--line-strong); }
  .sw[aria-pressed="true"] { border-color: var(--card); box-shadow: 0 0 0 2px var(--fg); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .list li { display: flex; align-items: center; gap: 8px; }
  .list li > input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; flex-shrink: 0; }
  .list .add { color: var(--muted); padding-left: 1px; }
  .item { flex: 1; height: 30px; border-color: transparent; background: transparent; padding: 0 8px; }
  .item:hover { border-color: var(--line); }
  .item.done { text-decoration: line-through; color: var(--muted); }
  .grow { flex: 1; }
  .acts { display: flex; gap: 8px; margin-top: 8px; }
  .del { display: inline-flex; align-items: center; gap: 6px; }
  @media (max-width: 620px) { .row { grid-template-columns: 1fr; } }
</style>
