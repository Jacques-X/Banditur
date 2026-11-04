<script>
  // One card on the Xogħol board. Ticking a checklist item saves at once;
  // anywhere else opens the edit dialog (or starts a drag, see Xoghol.svelte).
  import Icon from '../../components/Icon.svelte';
  import { labelById, dueInfo, progress } from './model.js';

  let { task, today, finished = false, temp = false, ondown, onopen, ontoggle, onkey } = $props();

  const SHOW = 5;
  const label = $derived(labelById(task.label));
  const due = $derived(dueInfo(task.due_date, today, finished));
  const prog = $derived(progress(task.checklist || []));
  const items = $derived((task.checklist || []).slice(0, SHOW));
  const more = $derived(Math.max(0, (task.checklist || []).length - SHOW));
  const hasNotes = $derived(!!task.notes?.trim());
  const aria = $derived(
    [task.title, label?.name, due && `Data: ${due.text}`, prog.total && `${prog.done} minn ${prog.total} lesti`]
      .filter(Boolean).join(', '),
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<article class="tcard" class:temp class:finished data-card={task.id} tabindex="0" aria-label={aria}
         style={label ? `--lab: ${label.color}` : ''}
         onpointerdown={e => ondown?.(e, task, e.currentTarget)}
         onclick={e => { if (!e.target.closest('label, input')) onopen?.(task); }}
         onkeydown={e => onkey?.(e, task)}>
  <h3>{task.title}</h3>
  {#if items.length}
    <ul class="items">
      {#each items as item (item.id)}
        <li>
          <label class:done={item.done}>
            <input type="checkbox" checked={item.done} disabled={temp}
                   onchange={e => ontoggle?.(task.id, item.id, e.currentTarget.checked)} />
            <span>{item.text}</span>
          </label>
        </li>
      {/each}
    </ul>
    {#if more}<p class="more">+{more} oħra</p>{/if}
  {/if}
  {#if due || prog.total || hasNotes}
    <footer>
      {#if due}<span class="due {due.tone}"><Icon name="calendar" size={12} />{due.text}</span>{/if}
      {#if prog.total}<span class="prog" class:all={prog.done === prog.total}><Icon name="check" size={12} stroke={2.4} />{prog.done}/{prog.total}</span>{/if}
      {#if hasNotes}<span class="notes" title="Għandu noti"><Icon name="doc" size={12} /></span>{/if}
    </footer>
  {/if}
</article>

<style>
  .tcard {
    position: relative; display: flex; flex-direction: column; gap: 8px;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px 10px 14px; box-shadow: var(--shadow-sm); cursor: grab;
    outline: none; touch-action: none;
  }
  .tcard::before {
    content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px;
    border-radius: 0 3px 3px 0; background: var(--lab, transparent);
  }
  .tcard:hover { border-color: var(--line-strong); }
  .tcard:focus-visible { box-shadow: var(--focus); border-color: var(--accent); }
  .tcard.temp { opacity: .65; cursor: progress; }
  .tcard.finished h3 { color: var(--muted); }
  h3 { font-size: 13.5px; font-weight: 600; line-height: 1.35; margin: 0; overflow-wrap: anywhere; }
  .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .items label { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; color: var(--fg-2); cursor: pointer; line-height: 1.35; }
  .items input { margin: 1px 0 0; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
  .items span { overflow-wrap: anywhere; }
  .items .done span { text-decoration: line-through; color: var(--muted); }
  .more { margin: 0; font-size: 12px; color: var(--muted); }
  footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  footer span { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--muted); border-radius: 5px; padding: 2px 6px; background: var(--bg-sunken); }
  .due.overdue { background: var(--danger-bg); color: var(--danger-fg); }
  .due.today { background: var(--warn-bg); color: var(--warn-fg); }
  .due.soon { background: var(--accent-soft); color: var(--accent-fg); }
  .prog.all { background: var(--ok-bg); color: var(--ok-fg); }
  .notes { padding: 2px 4px; }
</style>
