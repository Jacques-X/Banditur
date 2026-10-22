<script>
  import Icon from '../components/Icon.svelte';
  import { TOOLS, openTool, jobs, clearJobs, confirm } from '../lib/app.svelte.js';
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
</script>

<div class="studio scroll">
  <div><h1>Studio</h1><p class="muted lead">Għodda li jaħdmu fuq dan il-Mac — ir-ritratti u l-videos ma jitilgħu mkien.</p></div>

  <div class="tools">
    {#each TOOLS as t (t.id)}
      <button class="tool card" type="button" onclick={() => openTool(t.id)}>
        <Icon name={t.icon} size={22} />
        <strong>{t.label}</strong>
        <span class="muted small">{t.desc}</span>
        <kbd>⌘{t.key}</kbd>
      </button>
    {/each}
  </div>

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
  @media (max-width: 1240px) { .tools { grid-template-columns: repeat(3, minmax(0, 1fr)); } .jr { grid-template-columns: 100px minmax(0, 1fr) 200px 90px 70px; } }
</style>
