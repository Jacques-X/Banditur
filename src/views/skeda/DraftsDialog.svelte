<script>
  import Modal from '../../components/Modal.svelte';
  import { ui, openDraft, deleteDraft } from './composer.svelte.js';
  import { shortDateTime } from '../../lib/format.js';
  import { platformById } from '../../platforms.js';

  let { onclose } = $props();
  const typeName = t => (t === 'reel' ? 'Reel' : t === 'story' ? 'Storja' : 'Post');
</script>

<Modal title="Abbozzi" width={620} {onclose}>
  {#if !ui.drafts.length}
    <div class="empty"><strong>L-ebda abbozz.</strong>Meta tissejvja abbozz, jidher hawn — bil-midja tiegħu.</div>
  {:else}
    <ul class="list">
      {#each ui.drafts as d (d.id || d.savedAt)}
        <li>
          <button class="open" type="button" onclick={async () => { await openDraft(d); onclose(); }}>
            <span class="cap truncate">{(d.caption || '(mingħajr kaption)').split('\n')[0]}</span>
            <span class="meta muted small">
              {typeName(d.contentType)} · {(d.platforms || []).map(id => platformById(id)?.short || id).join(' ')}{d.mediaCount ? ` · ${d.mediaCount} midja` : ''} · issejvjat {shortDateTime(d.savedAt)}
            </span>
          </button>
          <button class="btn ghost sm" type="button" aria-label="Ħassar l-abbozz" onclick={() => deleteDraft(d)}>Ħassar</button>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line-soft); }
  .open { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; text-align: left; border: 0; background: none; padding: 10px 6px; border-radius: 8px; color: var(--fg); }
  .open:hover { background: var(--hover); }
  .cap { font-weight: 500; }
</style>
