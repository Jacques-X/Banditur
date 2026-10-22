<script>
  import Icon from '../components/Icon.svelte';
  import { app, go, openTool, openSettings, TOOLS, jobs, clearJobs, confirm, profileName } from '../lib/app.svelte.js';
  import { queue, statusOf } from '../lib/queue.svelte.js';
  import { shortDateTime, longDate } from '../lib/format.js';
  import { openPath } from '../lib/tauri.js';
  import { listRecentSessions } from '../subtitles/editor.js';
  import { ago } from '../lib/format.js';
  import { handoffTx } from './traskrittura/handoff.svelte.js';

  // Transcription sessions come from the editor's own autosave; the rest from logJob().
  const items = $derived.by(() => {
    jobs.length;
    const tx = listRecentSessions(6).map(s => ({ tool: 'Traskrittura', name: s.name, status: `${s.cues} subtitles · editjat`, tone: 'warn', at: s.savedAt, resume: s.path }));
    return [...tx, ...jobs].sort((a, b) => b.at - a.at).slice(0, 12);
  });

  const hello = () => { const h = new Date().getHours(); return h < 18 ? 'Bonġu' : 'Bonswa'; };
  const next = $derived(queue.upcoming[0]);
  const SOCIAL = $derived([
    { id: 'skeda', label: 'Skeda', icon: 'pen', key: '1', desc: next ? `Jmiss: ${shortDateTime(new Date(next.scheduled_time))} · ${statusOf(next).label}` : 'Ikteb u skeda post ġdid' },
    { id: 'kalendarju', label: 'Kalendarju', icon: 'calendar', key: '2', desc: 'L-avvenimenti u l-posts fuq kalendarju' },
    { id: 'arkivju', label: 'L-Arkivju', icon: 'inbox', key: '3', desc: app.failed ? `${app.failed} fallew — ħares lejhom` : `${app.pending} pending · l-posts kollha` },
    { id: 'rapporti', label: 'Rapporti', icon: 'chart', key: '4', desc: 'Rapport tal-PR b\'numri u PDF' },
  ]);
</script>

<div class="studio scroll">
  <div>
    <h1>{hello()}</h1>
    <p class="muted lead">{longDate(new Date())} · {profileName()}</p>
  </div>

  <section aria-label="Social" class="grp">
    <div class="rh"><h2>Social</h2><span class="muted small">Skeda, kalendarju, arkivju u rapporti</span></div>
    <div class="tools four">
      {#each SOCIAL as t (t.id)}
        <button class="tool card" type="button" onclick={() => go(t.id)}>
          <Icon name={t.icon} size={22} />
          <strong>{t.label}</strong>
          <span class="small desc" class:bad={t.id === 'arkivju' && app.failed}>{t.desc}</span>
          <kbd>{t.key}</kbd>
        </button>
      {/each}
    </div>
  </section>

  <section aria-label="Studio" class="grp">
    <div class="rh"><h2>Studio</h2><span class="muted small">Għodda li jaħdmu fuq dan il-Mac — ir-ritratti u l-videos ma jitilgħu mkien.</span></div>
  <div class="tools">
    {#each TOOLS as t (t.id)}
      <button class="tool card" type="button" onclick={() => openTool(t.id)}>
        <Icon name={t.icon} size={22} />
        <strong>{t.label}</strong>
        <span class="muted small desc">{t.desc}</span>
        <kbd>⌘{t.key}</kbd>
      </button>
    {/each}
  </div>
  </section>

  <section aria-label="Xogħol riċenti" class="recent">
    <div class="rh"><h2>Xogħol riċenti</h2><span class="muted small">Kompli minn fejn ħallejt, jew iftaħ il-folder</span><span class="spacer"></span>
      {#if jobs.length}<button class="link small" type="button" onclick={async () => { if (await confirm('Tneħħi l-lista tax-xogħol riċenti? Il-files ma jintmessux.', { yes: 'Neħħi', no: 'Żomm' })) clearJobs(); }}>Naddaf il-lista</button>{/if}
    </div>
    {#if items.length}
      <div class="table card">
        {#each items as j, i (i)}
          <div class="jr">
            <span class="muted">{j.tool}</span>
            <span class="truncate name">{j.name}</span>
            <span class="small st {j.tone}">{j.status}</span>
            <span class="mono muted">{ago(j.at)}</span>
            {#if j.resume}<button class="link" type="button" onclick={() => { handoffTx.open = j.resume; openTool('traskrittura'); }}>Kompli</button>
            {:else if j.path}<button class="link" type="button" onclick={() => openPath(j.path)}>Iftaħ</button>
            {:else}<span></span>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="card empty"><strong>Għad m'hemm xejn hawn.</strong>Meta tuża xi għodda, ix-xogħol jidher hawn biex tkompli jew issib il-files.</div>
    {/if}
  </section>
</div>

<style>
  .studio { flex: 1; padding: 36px max(40px, calc((100% - 1200px) / 2)); display: flex; flex-direction: column; gap: 28px; }
  .lead { margin-top: 4px; }
  .grp { display: flex; flex-direction: column; gap: 10px; }
  .tools.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .desc { color: var(--muted); }
  .desc.bad { color: var(--danger-fg); font-weight: 600; }
  .tools { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
  .tool { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 16px; text-align: left; color: var(--fg); line-height: 1.4; }
  .tool:hover { border-color: var(--accent); }
  .tool :global(svg) { color: var(--accent-fg); }
  .tool kbd { position: absolute; top: 14px; right: 14px; }
  .recent { display: flex; flex-direction: column; gap: 10px; }
  .rh { display: flex; align-items: baseline; gap: 10px; }
  .table { overflow: hidden; }
  .jr { display: grid; grid-template-columns: 120px minmax(0, 1fr) 260px 110px 90px; gap: 16px; align-items: center; padding: 11px 16px; border-bottom: 1px solid var(--line-soft); }
  .jr:last-child { border-bottom: 0; }
  .jr .link { justify-self: end; }
  .name { font-weight: 500; }
  .st.ok { color: var(--ok-fg); } .st.warn { color: var(--warn-fg); } .st.error { color: var(--danger-fg); }
  @media (max-width: 1240px) { .tools.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tools { grid-template-columns: repeat(3, minmax(0, 1fr)); } .jr { grid-template-columns: 100px minmax(0, 1fr) 200px 90px 70px; } }
</style>
