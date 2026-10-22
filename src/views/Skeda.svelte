<script>
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { anyModalOpen } from '../components/Modal.svelte';
  import MediaTray from './skeda/MediaTray.svelte';
  import CaptionBox from './skeda/CaptionBox.svelte';
  import PostPreview from './skeda/PostPreview.svelte';
  import DriveBrowser from './skeda/DriveBrowser.svelte';
  import DraftsDialog from './skeda/DraftsDialog.svelte';
  import {
    post, ui, changed, togglePlatform, needsExpiry, schedule, saveDraft, confirmReset,
    restoreAutosave, reuseLast, addMedia, autosave,
  } from './skeda/composer.svelte.js';
  import { app, go, toast, openSettings } from '../lib/app.svelte.js';
  import { queue, refreshCounts, statusOf } from '../lib/queue.svelte.js';
  import { onDragDrop, fileFromPath } from '../lib/tauri.js';
  import { toLocalInput, whenLabel, hhmm } from '../lib/format.js';
  import { visiblePlatforms } from '../platforms.js';
  import { SCHED } from '../strings.js';

  let { active } = $props();
  let drive = $state(false);
  let drafts = $state(false);

  onMount(() => { restoreAutosave(); });
  $effect(() => { app.profileId; if (active) refreshCounts(); });

  // Files dropped onto the window (Tauri gives paths, not File objects).
  onMount(() => onDragDrop(async p => {
    if (!active || p.type !== 'drop' || !p.paths?.length) return;
    try { addMedia(await Promise.all(p.paths.map(path => fileFromPath(path)))); }
    catch (e) { toast(e.message, 'error'); }
  }));

  const presets = [
    { id: 'hour', label: 'Wara siegħa', make: () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; } },
    { id: 'tonight', label: 'Illejla 20:00', make: () => { const d = new Date(); d.setHours(20, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d; } },
    { id: 'am', label: 'Għada 09:00', make: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { id: 'pm', label: 'Għada 18:30', make: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 30, 0, 0); return d; } },
  ];
  const presetOn = id => toLocalInput(presets.find(p => p.id === id).make()) === post.scheduledTime;
  const types = [['post', 'Post'], ['reel', 'Reel'], ['story', 'Story']];
  const whenShort = $derived(post.scheduledTime ? whenLabel(post.scheduledTime) : '');

  async function doSchedule() {
    if (await schedule()) {
      toast(SCHED.scheduled, 'ok', { label: 'Ara fil-queue', onClick: () => go('arkivju') });
    }
  }
  function keydown(e) {
    if (!active || anyModalOpen()) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSchedule(); }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="skeda">
  <div class="body">
    <section class="form" aria-label="Post ġdid">
      <div class="page-head">
        <h1>Post ġdid</h1>
        <span class="muted">
          {#if ui.dirty}Bidliet mhux issejvjati…{:else if ui.savedAt}Draft issejvjat <span class="mono">{hhmm(ui.savedAt)}</span>{/if}
        </span>
        <span class="spacer"></span>
        <button class="btn" type="button" onclick={() => (drafts = true)}>Drafts{ui.drafts.length ? ` (${ui.drafts.length})` : ''}</button>
        <button class="btn" type="button" onclick={async () => { const d = await saveDraft(); toast(d.mediaCount ? `${SCHED.draft_saved} (bi ${d.mediaCount} media)` : SCHED.draft_saved, 'ok'); autosave(); }}>Save draft</button>
        <button class="btn ghost" type="button" onclick={confirmReset}>Ibda mill-ġdid</button>
      </div>

      <div class="row">
        <div class="seg" role="group" aria-label="Tip ta' kontenut">
          {#each types as [id, label]}
            <button type="button" aria-pressed={post.contentType === id} onclick={() => { post.contentType = id; changed(); }}>{label}</button>
          {/each}
        </div>
        <span class="vsep" aria-hidden="true"></span>
        {#each visiblePlatforms() as p (p.id)}
          {#if p.available}
            <button class="chip" type="button" aria-pressed={post.platforms.includes(p.id)} onclick={() => togglePlatform(p.id)}>
              {post.platforms.includes(p.id) ? '✓ ' : ''}{p.label}
            </button>
          {:else}
            <button class="chip" type="button" disabled title="{p.label}: għadu mhux disponibbli">{p.label.split(' /')[0]} · Dalwaqt</button>
          {/if}
        {/each}
      </div>

      <MediaTray ondrive={() => (drive = true)} />
      <CaptionBox />

      {#if needsExpiry()}
        <div class="field expiry">
          <label class="label" for="expiry">Jiskadi</label>
          <input id="expiry" class="input" type="datetime-local" bind:value={post.expiryTime} onchange={changed} />
        </div>
      {/if}

      <div class="when">
        <label class="dt">
          <Icon name="clock" size={15} />
          <span class="sr-only">Data u ħin tal-pubblikazzjoni</span>
          <input type="datetime-local" bind:value={post.scheduledTime} onchange={changed} />
        </label>
        {#each presets as p (p.id)}
          <button class="chip round" type="button" aria-pressed={presetOn(p.id)}
                  onclick={() => { post.scheduledTime = toLocalInput(p.make()); changed(); }}>{p.label}</button>
        {/each}
      </div>

      <div class="act">
        {#if ui.status}
          <div class="notice {ui.status.tone}" role={ui.status.tone === 'error' ? 'alert' : 'status'}>
            <span>{ui.status.msg}</span>
            {#if ui.status.tone === 'ok' && ui.lastScheduled}<button class="link" type="button" onclick={reuseLast}>Erġa' uża dan il-post</button>{/if}
            {#if /Settings/.test(ui.status.msg)}<button class="link" type="button" onclick={() => openSettings('konnessjoni')}>Iftaħ is-Settings</button>{/if}
          </div>
        {:else}
          <span class="muted small">{whenShort ? `Jitla' ${whenShort.toLowerCase()} · ħin ta' Malta` : ''}</span>
        {/if}
        <span class="spacer"></span>
        <button class="btn primary lg" type="button" disabled={ui.busy} onclick={doSchedule}>
          {ui.busy ? 'Qed jiskeda…' : 'Iskeda'} <span class="hint">⌘↵</span>
        </button>
      </div>
    </section>

    <aside class="side" aria-label="Preview">
      <PostPreview />
    </aside>
  </div>

  <section class="next" aria-label="Jmiss">
    <div class="next-h"><strong>Jmiss</strong><button class="link small" type="button" onclick={() => go('arkivju')}>Ara kollox</button></div>
    {#if post.caption.trim() || post.media.length}
      <div class="nc current"><span class="mono t">{whenShort.toUpperCase() || '—'} · {post.platforms.map(p => p.toUpperCase()).join(' ')}</span><span class="truncate"><b>Dan il-post</b></span></div>
    {/if}
    {#each queue.upcoming.slice(0, post.caption.trim() || post.media.length ? 3 : 4) as p (p.id)}
      {@const s = statusOf(p)}
      <div class="nc"><span class="mono t">{whenLabel(p.scheduled_time, { upper: true })} · {s.label.toUpperCase()}</span><span class="truncate">{(p.caption || '(mingħajr caption)').split('\n')[0]}</span></div>
    {:else}
      {#if !(post.caption.trim() || post.media.length)}<div class="nc empty-nc muted">{queue.error || 'L-ebda post fil-queue.'}</div>{/if}
    {/each}
    {#if queue.latestFailed}
      <div class="nc failed"><span class="mono t">{whenLabel(queue.latestFailed.scheduled_time, { upper: true })} · FAILED</span><span class="truncate">{(queue.latestFailed.caption || '').split('\n')[0]}</span><button class="link small" type="button" onclick={() => go('arkivju')}>Ara x'ġara</button></div>
    {/if}
  </section>
</div>

{#if drive}<DriveBrowser onclose={() => (drive = false)} />{/if}
{#if drafts}<DraftsDialog onclose={() => (drafts = false)} />{/if}

<style>
  .skeda { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .body { flex: 1; min-height: 0; display: flex; justify-content: center; gap: 36px; padding: 26px 40px 18px; overflow: auto; }
  .form { width: 720px; min-width: 0; display: flex; flex-direction: column; gap: 18px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .vsep { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }
  .when { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dt { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px 0 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--input); color: var(--muted); }
  .dt:focus-within { border-color: var(--accent); box-shadow: var(--focus); }
  .dt input { border: 0; outline: none; background: transparent; color: var(--fg); font-family: var(--font-mono); font-size: 12px; }
  .expiry { max-width: 260px; }
  .act { display: flex; align-items: center; gap: 12px; min-height: 36px; }
  .act .notice { flex: 1; padding: 8px 12px; align-items: center; }
  .side { width: 340px; flex-shrink: 0; padding-top: 50px; }
  .next { flex-shrink: 0; display: flex; gap: 10px; align-items: stretch; padding: 12px 24px; border-top: 1px solid var(--line); background: var(--bg-sunken); overflow-x: auto; }
  .next-h { width: 84px; flex-shrink: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .nc { flex: 0 1 250px; min-width: 170px; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); }
  .nc .t { color: var(--muted); font-size: 11px; }
  .nc.current { border-color: var(--accent); }
  .nc.current .t { color: var(--accent-fg); }
  .nc.failed { background: var(--danger-bg); border-color: var(--danger-line); }
  .nc.failed .t { color: var(--danger-fg); }
  .nc .link { align-self: flex-start; }
  .empty-nc { justify-content: center; border-style: dashed; background: transparent; }
  @media (max-width: 1180px) {
    .body { gap: 24px; padding: 20px 24px 14px; }
    .side { width: 290px; }
  }
</style>
