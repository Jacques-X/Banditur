<script>
  // Home: a card that was just plugged in, and the upload jobs (progress, pause, "safe to format").
  import { arch, openReview, dismissOffer, pauseJob, resumeJob, removeJob, ejectCard, jobStats, safeToFormat, setCfg, canArchive, chooseFolder } from '../lib/archive.svelte.js';
  import Icon from './Icon.svelte';
  import { sizeLabel } from '../lib/archive-job.js';
  import { plural } from '../lib/format.js';

  const STATE = { queued: 'Fil-queue', running: 'Qed jitella’', paused: 'Waqfa', interrupted: 'Interrott', failed: 'Fadal xi fajls', done: 'Lest' };
  const stats = (j) => jobStats(j);
  const sent = (j) => j.items.reduce((n, i) => n + (i.state === 'pending' ? arch.sent[i.id] || 0 : 0), 0);
  const pct = (j) => { const s = stats(j); return s.bytes ? Math.min(100, Math.round(((s.bytesDone + sent(j)) / s.bytes) * 100)) : 0; };
  // A folder job can always be resumed (if the folder is gone, the upload says so); a card job needs its card.
  const cardHere = (j) => j.source === 'folder' || arch.cards.some((c) => c.path === j.card);
</script>

{#if canArchive()}
<section class="recent" aria-label="Card u Arkivju">
  <div class="rh"><h2>Arkivju fuq Drive</h2><span class="muted small">Daħħal card, jew agħżel folder</span>
    <span class="spacer"></span>
    <button class="btn sm" type="button" onclick={() => chooseFolder()}><Icon name="folder" size={14} />Tella’ folder…</button></div>

  {#if arch.offer}
    <div class="notice info offer">
      <span><strong>{arch.offer.name}</strong> daħlet. Tixtieq tgħabbiha fl-Arkivju?</span>
      <span class="spacer"></span>
      <button class="btn sm primary" type="button" onclick={() => openReview(arch.offer)}>Ara u itella’</button>
      <button class="btn sm ghost" type="button" onclick={dismissOffer}>Mhux issa</button>
    </div>
  {/if}

  {#each arch.jobs as j (j.id)}
    {@const s = stats(j)}
    <div class="card job">
      <div class="top">
        <strong>{j.label}</strong>
        <span class="muted small">{j.events.join(' · ')}</span>
        <span class="spacer"></span>
        <span class="small st" class:ok={j.state === 'done'} class:warn={j.state === 'failed' || j.state === 'interrupted'}>{STATE[j.state]}</span>
      </div>
      {#if j.state !== 'done'}
        <div class="bar" role="progressbar" aria-valuenow={pct(j)} aria-valuemin="0" aria-valuemax="100"><span style="width:{pct(j)}%"></span></div>
      {/if}
      <div class="small muted">
        {s.done + s.skipped}/{s.total} fajls · {sizeLabel(s.bytesDone)} minn {sizeLabel(s.bytes)}{s.skipped ? ` · ${s.skipped} diġà hemm` : ''}{j.state === 'running' && arch.now ? ` · ${arch.now}` : ''}
        {#if j.error}<span class="warn-text"> · {j.error}</span>{/if}
      </div>
      {#if j.state === 'done' && j.source === 'folder'}
        {#if !j.leftOut}<div class="notice ok-note small">Kollox fuq Drive u ċċekkjat.</div>{:else}<div class="notice info small">Xi fajls f’subfolders fondi wisq ma tellgħux.</div>{/if}
      {:else if j.state === 'done' && safeToFormat(j)}
        <div class="notice ok-note small">Kollox fl-Arkivju u ċċekkjat. <strong>Tista’ tifformattja l-card.</strong></div>
      {:else if j.state === 'done'}
        <div class="notice info small">Xi fajls ħallejthom barra. Żomm il-card sakemm tkun trid.</div>
      {/if}
      <div class="acts small">
        {#if j.state === 'running'}<button class="link" type="button" onclick={() => pauseJob(j.id)}>Waqqaf</button>{/if}
        {#if ['paused', 'interrupted', 'failed'].includes(j.state)}<button class="link" type="button" onclick={() => resumeJob(j.id)} disabled={!cardHere(j)}>{cardHere(j) ? 'Kompli' : 'Poġġi l-card lura biex tkompli'}</button>{/if}
        {#if j.state === 'done' && cardHere(j) && safeToFormat(j)}<button class="link" type="button" onclick={() => ejectCard(j.card)}>Neħħi l-card</button>{/if}
        {#if j.state !== 'running'}<button class="link" type="button" onclick={() => removeJob(j.id)}>Neħħi mil-lista</button>{/if}
        <span class="spacer"></span>
        <label>Veloċità <select class="select sm" value={arch.cfg.limitKbps} onchange={(e) => setCfg({ limitKbps: +e.currentTarget.value })}>
          <option value={0}>Bla limitu</option><option value={2048}>2 MB/s</option><option value={512}>0.5 MB/s</option>
        </select></label>
      </div>
    </div>
  {/each}
</section>
{/if}

<style>
  .recent { display: flex; flex-direction: column; gap: 10px; }
  .rh { display: flex; align-items: baseline; gap: 10px; }
  .rh .btn { display: inline-flex; gap: 6px; align-items: center; }
  .offer { display: flex; align-items: center; gap: 12px; }
  .job { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .top { display: flex; gap: 10px; align-items: baseline; }
  .bar { height: 6px; background: var(--line-soft); border-radius: 3px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width .3s; }
  .st.ok { color: var(--ok-fg); } .st.warn, .warn-text { color: var(--warn-fg); }
  .acts { display: flex; gap: 14px; align-items: center; }
  .spacer { flex: 1; }
</style>
