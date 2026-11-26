<script>
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import WatermarkPacks from './marka/WatermarkPacks.svelte';
  import { marks, refreshPacks, markCount } from './marka/packs.svelte.js';
  import { app, toast, confirm, saveConfig, setTheme, setStudioDark, TOOLS, configured } from '../lib/app.svelte.js';
  import { api } from '../lib/api.js';
  import { sharing, setSharing } from '../lib/sharing.svelte.js';
  import { localTasks } from './xoghol/local-store.js';
  import { load as loadBoards } from './xoghol/board.svelte.js';
  import { store as calLocal, load as loadCal } from './kalendarju/calendar.svelte.js';
  import { health, runHealth } from '../lib/health.svelte.js';
  import { refreshCounts } from '../lib/queue.svelte.js';
  import { invoke } from '../lib/tauri.js';
  import { ago } from '../lib/format.js';
  import { TOAST, UPD } from '../strings.js';
  import { upd, checkUpdates, startUpdate, busyNow } from '../lib/updates.svelte.js';
  import { buttonState, stateLines, updateState, commitLine } from '../lib/updates.js';

  let { active } = $props();
  const SECTIONS = [
    ['sistema', 'System'], ['konnessjoni', 'Connection'], ['qsim', 'Sharing'], ['dehra', 'Appearance'],
    ['marki', 'Watermarks'], ['aggornamenti', 'Components'], ['shortcuts', 'Shortcuts'],
  ];
  let packsOpen = $state(false);

  $effect(() => { if (active && app.settingsSection === 'sistema' && !health.running && Date.now() - health.at > 60000) untrack(runHealth); });
  $effect(() => { if (active && app.settingsSection === 'marki' && !marks.loaded) untrack(refreshPacks); });

  // ── Connection ────────────────────────────────────────────────────────────
  let form = $state({ vercelUrl: '', apiKey: '', supabaseUrl: '', supabaseKey: '' });
  let showKeys = $state(false);
  $effect(() => {
    if (active && app.settingsSection === 'konnessjoni') untrack(() => {
      const c = app.config;
      form = { vercelUrl: c.vercelUrl || '', apiKey: c.apiKey || '', supabaseUrl: c.supabaseUrl || '', supabaseKey: c.supabaseKey || '' };
    });
  });
  async function saveConn() {
    const cfg = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim().replace(/\/+$/, k === 'vercelUrl' ? '' : '$&')]));
    if (cfg.vercelUrl && !/^https?:\/\//.test(cfg.vercelUrl)) { toast('Il-Backend URL irid jibda b\'https://', 'warn'); return; }
    await saveConfig(cfg);
    toast(TOAST.settings_saved, 'ok');
    runHealth();
    refreshCounts();
  }
  async function resetConn() {
    if (!await confirm('Tneħħi s-settings tal-konnessjoni minn dan il-kompjuter? Jekk l-app għandha konfigurazzjoni inkluża, terġa\' tintuża dik.', { yes: 'Neħħi', no: 'Żomm', danger: true })) return;
    try { localStorage.removeItem('banditur_config'); } catch { /* ignore */ }
    await saveConfig({});
    runHealth();
  }

  // ── Installed pieces (engine and model live outside the app: npm run build:local) ──
  let comps = $state(null);
  $effect(() => {
    if (!active || app.settingsSection !== 'aggornamenti') return;
    untrack(async () => { try { comps = await invoke('components_status'); } catch { comps = null; } });
  });
  // GitHub updates: look again when the section opens.
  $effect(() => { if (active && app.settingsSection === 'aggornamenti') untrack(checkUpdates); });
  const upBtn = $derived(buttonState(upd.status, { running: upd.running, checking: upd.checking, busy: busyNow() }));
  const upLines = $derived(upd.running ? [upd.progress || UPD.updating] : stateLines(upd.status));
  const upTone = $derived({ error: 'warn', dirty: 'warn', diverged: 'warn', behind: 'info', pending: 'info', current: 'ok' }[updateState(upd.status, { running: upd.running })] || 'info');
  let reloading = $state(false);
  async function reloadUi() {
    reloading = true;
    try { await invoke('reload_interface'); } catch { reloading = false; }
  }
  const FROM = { bundled: 'mill-app (verżjoni qadima)', dev: 'mill-proġett (żvilupp)', missing: 'mhix installata' };
  const pieceText = (source, version) => (source === 'installed' ? `verżjoni ${version ?? '?'}` : FROM[source] || '—');

  // ── Sharing (Xogħol and Kalendarju on the server for the whole committee) ──
  const SHARE = {
    xoghol: { name: 'Xogħol', path: '/api/tasks', reload: () => loadBoards(app.profileId, { force: true }) },
    calendar: { name: 'Kalendarju', path: '/api/events', reload: () => loadCal() },
  };
  let shareBusy = $state('');
  /** What this Mac has, per profile: [{ profileId, count, body }] */
  async function localCopies(kind) {
    const ids = app.profiles.length ? app.profiles.map(p => p.id) : [app.profileId];
    const out = [];
    for (const profile_id of ids) {
      if (kind === 'xoghol') {
        const r = await localTasks.request({ query: { profile_id } });
        if (r.boards?.length) out.push({ profileId: profile_id, count: r.tasks.length, boards: r.boards.length, body: { profile_id, boards: r.boards, columns: r.columns, tasks: r.tasks } });
      } else {
        const r = calLocal.list(profile_id);
        if (r.events.length) out.push({ profileId: profile_id, count: r.events.length, body: { profile_id, events: r.events, labels: r.labels } });
      }
    }
    return out;
  }
  async function shareOn(kind) {
    if (!configured()) { toast('Qabbad mal-backend l-ewwel.', 'warn'); app.settingsSection = 'konnessjoni'; return; }
    const S = SHARE[kind];
    shareBusy = kind;
    try {
      await api(S.path, { query: { profile_id: app.profileId } }); // is the server ready? (a missing migration is explained)
      const local = await localCopies(kind);
      const total = local.reduce((n, l) => n + l.count, 0);
      const what = kind === 'xoghol' ? `${local.reduce((n, l) => n + l.boards, 0)} boards (${total} kompiti)` : `${total} avvenimenti`;
      const send = local.length && await confirm(`Fuq dan il-Mac għandek ${what}. Tibgħathom fuq is-server biex jarahom il-kumitat? Dak li hemm diġà fuq is-server jibqa’ kif inhu.`, { yes: 'Ibgħat u aqsam', no: 'Aqsam biss' });
      let sent = 0, bad = 0;
      if (send) for (const l of local) {
        const r = await api(S.path, { method: 'POST', query: { type: 'import' }, body: l.body });
        sent += r.imported || 0; bad += r.bad?.length || 0;
      }
      setSharing(kind, true);
      await S.reload();
      toast(`${S.name} issa maqsum mal-kumitat.${send ? ` Intbagħtu ${sent}.` : ''}${bad ? ` ${bad} ma ntbagħtux (mhux validi).` : ''}`, bad ? 'warn' : 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      shareBusy = '';
    }
  }
  async function shareOff(kind) {
    const S = SHARE[kind];
    if (!await confirm(`Terġa’ lura għall-kopja ta’ ${S.name} fuq dan il-Mac? Il-bidliet li saru fuq is-server jibqgħu hemm, imma ma jidhrux hawn.`, { yes: 'Erġa’ lura', no: 'Ibqa’ maqsum' })) return;
    setSharing(kind, false);
    await S.reload();
  }

  const tone = { ok: 'ok', warn: 'warn', error: 'danger' };
</script>

<div class="settings">
  <nav class="side" aria-label="Taqsimiet tas-Settings">
    <h1>Settings</h1>
    {#each SECTIONS as [id, label]}
      <button type="button" class="sec" aria-current={app.settingsSection === id ? 'page' : undefined} onclick={() => (app.settingsSection = id)}>{label}</button>
    {/each}
  </nav>

  <section class="content scroll">
    {#if app.settingsSection === 'sistema'}
      <div class="h"><h2>System</h2><span class="muted small">{health.at ? `iċċekkjat ${ago(health.at)}` : ''}</span><span class="spacer"></span>
        <button class="btn" type="button" disabled={health.running} onclick={runHealth}><Icon name="refresh" size={14} />{health.running ? 'Qed niċċekkja…' : 'Iċċekkja mill-ġdid'}</button>
        <button class="btn" type="button" onclick={async () => {
          const text = [`Banditur ${app.version || '?'} · ${navigator.userAgent}`, `Backend: ${app.config.vercelUrl || '—'} (${app.configSource})`, ...health.checks.map(c => `[${c.tone}] ${c.name}: ${c.detail}${c.ver ? ` (${c.ver})` : ''}`)].join('\n');
          try { await navigator.clipboard.writeText(text); toast('Ir-rapport ġie kkupjat. Waħħlu f\'email jew messaġġ.', 'ok'); } catch { toast('Ma stajtx nikkopja.', 'error'); }
        }}>Ikkopja rapport għall-appoġġ</button>
      </div>
      <div class="card checks">
        {#each health.checks as c (c.id)}
          <div class="chk {c.tone}">
            <span class="dot" aria-hidden="true">{c.tone === 'ok' ? '✓' : '!'}</span>
            <span class="ct"><strong>{c.name}</strong><span class="muted small">{c.detail}</span></span>
            <span class="mono muted">{c.ver || ''}</span>
            {#if c.fix}<button class="btn sm primary" type="button" onclick={() => (app.settingsSection = c.fix)}>Irranġa</button>{/if}
          </div>
        {:else}
          <div class="empty">Qed niċċekkja…</div>
        {/each}
      </div>
      <p class="help">yt-dlp, ffmpeg u il-model tat-traskrizzjoni jiġu ċċekkjati meta tużahom: jekk xi ħaġa nieqsa, l-għodda tgħidlek x'għandek tagħmel.</p>

    {:else if app.settingsSection === 'konnessjoni'}
      <div class="h"><h2>Connection</h2></div>
      {#if app.configSource === 'app'}<div class="notice info">Din l-app diġà għandha l-konfigurazzjoni tal-kumitat inkluża. Biddel hawn biss jekk qalulek.</div>{/if}
      <form class="card form" onsubmit={e => { e.preventDefault(); saveConn(); }}>
        <div class="field"><label class="label" for="c-url">Backend URL</label><input id="c-url" class="input mono-in" bind:value={form.vercelUrl} placeholder="https://….vercel.app" autocomplete="off" spellcheck="false" /></div>
        <div class="field"><label class="label" for="c-key">API Key</label><input id="c-key" class="input mono-in" type={showKeys ? 'text' : 'password'} bind:value={form.apiKey} autocomplete="off" spellcheck="false" /></div>
        <div class="field"><label class="label" for="c-sb">Supabase URL</label><input id="c-sb" class="input mono-in" bind:value={form.supabaseUrl} placeholder="https://….supabase.co" autocomplete="off" spellcheck="false" /><span class="help">Għall-upload tar-ritratti u l-videos tal-posts.</span></div>
        <div class="field"><label class="label" for="c-sbk">Supabase anon key</label><input id="c-sbk" class="input mono-in" type={showKeys ? 'text' : 'password'} bind:value={form.supabaseKey} autocomplete="off" spellcheck="false" /></div>
        <label class="check"><input type="checkbox" bind:checked={showKeys} />Uri l-keys</label>
        <div class="actions"><button class="btn primary" type="submit">Save u ċċekkja</button>{#if app.configSource === 'local'}<button class="btn ghost" type="button" onclick={resetConn}>Neħħi minn dan il-kompjuter</button>{/if}</div>
      </form>

    {:else if app.settingsSection === 'qsim'}
      <div class="h"><h2>Sharing</h2></div>
      <p class="help">Normalment Xogħol u l-Kalendarju jinżammu fuq dan il-Mac biss. Meta taqsamhom, jinżammu fuq is-server u kull min għandu l-app tal-kumitat jara l-istess boards u avvenimenti. Jeħtieġ il-migration <span class="mono">20261122_sharing.sql</span> u l-backend aġġornat.</p>
      <div class="card list">
        {#each Object.entries(SHARE) as [kind, S] (kind)}
          <div class="prow">
            <span class="sh"><strong>{S.name}</strong><span class="muted small">{sharing[kind] ? 'Maqsum mal-kumitat (fuq is-server)' : 'Fuq dan il-Mac biss'}</span></span>
            {#if sharing[kind]}
              <button class="btn" type="button" onclick={() => shareOff(kind)}>Erġa’ lura għal dan il-Mac</button>
            {:else}
              <button class="btn primary" type="button" disabled={!!shareBusy} onclick={() => shareOn(kind)}>{shareBusy === kind ? 'Qed niċċekkja…' : 'Aqsam mal-kumitat'}</button>
            {/if}
          </div>
        {/each}
      </div>
      <p class="help">Meta jkun maqsum, tħassir ma jistax jinġieb lura għal kulħadd, għalhekk l-app tistaqsik qabel.</p>

    {:else if app.settingsSection === 'dehra'}
      <div class="h"><h2>Appearance</h2></div>
      <div class="themes" role="radiogroup" aria-label="Tema">
        {#each [['light', 'Light'], ['dark', 'Dark'], ['system', 'System (bħall-Mac)']] as [id, label]}
          <button type="button" role="radio" aria-checked={app.theme === id} class="theme" onclick={() => setTheme(id)}>
            <span class="sw {id}" aria-hidden="true"></span>{label}{app.theme === id ? ' ✓' : ''}
          </button>
        {/each}
      </div>
      <label class="check"><input type="checkbox" checked={app.studioDark} onchange={e => setStudioDark(e.currentTarget.checked)} />Traskrittura, Murtali u Posts dejjem f'Dark mode — ir-ritratti u l-videos jidhru aħjar fuq sfond skur</label>

    {:else if app.settingsSection === 'marki'}
      <div class="h"><h2>Watermarks</h2><span class="spacer"></span><button class="btn primary" type="button" onclick={() => (packsOpen = true)}>Manage watermarks</button></div>
      <p class="help">Il-watermarks tal-fotografi ma jiġux mal-app: jiġu f'packs (.bwpack) li tinstalla hawn jew minn Ritratti.</p>
      <div class="card list">
        {#each marks.packs as p (p.id)}
          <div class="prow"><span><strong>{p.name}</strong> <span class="muted small">· version {p.version} · {p.watermarks.length} watermarks</span></span></div>
        {:else}
          <div class="empty">{marks.loaded ? 'L-ebda pack installat.' : 'Qed jgħabbi…'}</div>
        {/each}
      </div>
      <p class="muted small">{markCount()} watermarks installati b'kollox.</p>

    {:else if app.settingsSection === 'aggornamenti'}
      <div class="h"><h2>{UPD.title}</h2><span class="spacer"></span>
        <button class="btn" type="button" disabled={upd.checking || upd.running} onclick={checkUpdates}><Icon name="refresh" size={14} />{upd.checking ? UPD.checking : UPD.check}</button>
        <button class="btn primary" type="button" disabled={upBtn.disabled} onclick={startUpdate}>{upBtn.label}</button>
      </div>
      <div class="card form">
        {#if upd.status?.configured}
          <p><strong>{UPD.branch(upd.status.branch, upd.status.head)}</strong>{#if upd.status.upstream}<span class="muted"> · {upd.status.upstream}</span>{/if}</p>
        {/if}
        <div class="notice {upTone}" role="status">
          <span>{#each upLines as line}{line}{' '}{/each}</span>
        </div>
        {#if upBtn.reason}<p class="help">{upBtn.reason}</p>{/if}
        {#if upd.status?.configured && upd.status.commits?.length}
          <div>
            <p class="muted small">{UPD.waiting}</p>
            <ul class="commits">
              {#each upd.status.commits as c (c.hash)}<li class="mono">{commitLine(c)}</li>{/each}
            </ul>
          </div>
        {/if}
        {#if upd.error}
          <div class="notice danger" role="alert">
            <div>
              <strong>{UPD.failed_title}</strong>
              <div>{upd.error.msg}</div>
              {#if upd.error.detail}<pre class="logtail">{upd.error.detail}</pre><p class="help">{UPD.log_hint}</p>{/if}
            </div>
          </div>
        {/if}
        {#if upd.status && !upd.status.configured}<p class="help">{UPD.setup_help}</p>{/if}
      </div>

      <div class="h"><h2>Components</h2></div>
      <div class="card form">
        <p>Banditur <span class="mono">{app.version ? `v${app.version}` : ''}</span></p>
        {#if comps}
          <dl class="pieces">
            <dt>Interface (screens)</dt><dd>{comps.ui ? `verżjoni ${comps.ui}` : 'mill-app (inkluża)'}{comps.uiBad?.length ? ` · ma ħdimtx: ${comps.uiBad.join(', ')}` : ''}</dd>
            <dt>Transcription engine</dt><dd class:bad={comps.engine === 'missing'}>{pieceText(comps.engine, comps.installed.engine)}</dd>
            <dt>Maltese model</dt><dd class:bad={comps.model === 'missing'}>{pieceText(comps.model, comps.installed.model)}</dd>
          </dl>
          <p class="help">Dawn jinsabu barra mill-app (<span class="mono">{comps.dir}</span>) u jinbidlu meta taġġorna jew b’<span class="mono">npm run build:local</span>.</p>
        {/if}
        {#if comps}<div class="actions"><button class="btn" type="button" disabled={reloading} onclick={reloadUi}>Erġa’ ikkarga l-interface</button></div>{/if}
      </div>

    {:else}
      <div class="h"><h2>Shortcuts</h2></div>
      <div class="card keys">
        {#each [['1 – 3', 'Skeda (Post ġdid, L-Arkivju, Rapporti), Kalendarju, Xogħol'], ...TOOLS.map(t => [`⌘${t.key}`, t.label]), ['⌘↵', 'Iskeda l-post (fi Skeda)'], ['⌘K', 'Mur fejn trid: screens, avvenimenti, proġetti, posts'], ['⌘,', 'Settings'], ['Esc', 'Agħlaq dijalogu jew menu'], ['?', 'Ix-shortcuts tal-editur tas-subtitles']] as [k, d]}
          <div class="krow"><kbd>{k}</kbd><span>{d}</span></div>
        {/each}
      </div>
    {/if}
  </section>
</div>

{#if packsOpen}<WatermarkPacks onclose={() => (packsOpen = false)} />{/if}

<style>
  .settings { flex: 1; min-height: 0; display: flex; justify-content: center; gap: 40px; padding: 28px 40px 0; }
  .side { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
  .side h1 { margin: 0 0 14px 10px; }
  .sec { text-align: left; padding: 7px 10px; border-radius: 7px; border: 0; background: transparent; color: var(--fg-2); }
  .sec:hover { background: var(--hover); }
  .sec[aria-current="page"] { background: var(--accent-soft-2); color: var(--fg); font-weight: 600; }
  .content { width: 760px; min-width: 0; display: flex; flex-direction: column; gap: 16px; padding: 44px 2px 32px; }
  .h { display: flex; align-items: center; gap: 10px; }
  .checks { overflow: hidden; }
  .chk { display: flex; align-items: center; gap: 14px; padding: 13px 16px; border-bottom: 1px solid var(--line-soft); }
  .chk:last-child { border-bottom: 0; }
  .chk .dot { width: 22px; height: 22px; border-radius: 11px; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--ok); flex-shrink: 0; }
  .chk.warn { background: var(--warn-bg); } .chk.warn .dot { background: var(--warn); }
  .chk.error { background: var(--danger-bg); } .chk.error .dot { background: var(--danger); }
  .ct { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .form { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
  .mono-in { font-family: var(--font-mono); font-size: 12px; }
  .pieces { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 4px 0 10px; }
  .pieces dt { color: var(--muted); }
  .pieces dd { margin: 0; font-weight: 600; }
  .pieces dd.bad { color: var(--danger-fg); }
  .actions { display: flex; gap: 10px; align-items: center; }
  .commits { margin: 4px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .logtail { margin: 8px 0 0; max-height: 180px; overflow: auto; white-space: pre-wrap; font-family: var(--font-mono); font-size: 11px; background: var(--card); border: 1px solid var(--line); border-radius: 7px; padding: 8px; color: var(--fg); }
  .list { overflow: hidden; }
  .sh { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .prow { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line-soft); }
  .prow:last-child { border-bottom: 0; }
  .themes { display: flex; gap: 12px; }
  .theme { width: 160px; display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); text-align: left; }
  .theme[aria-checked="true"] { border: 2px solid var(--accent); background: var(--accent-soft); font-weight: 600; }
  .sw { height: 64px; border-radius: 7px; border: 1px solid var(--line); }
  .sw.light { background: #F1F2F4; }
  .sw.dark { background: #16171B; }
  .sw.system { background: linear-gradient(90deg, #F1F2F4 50%, #16171B 50%); }
  .keys { padding: 8px 16px; }
  .krow { display: grid; grid-template-columns: 90px 1fr; gap: 12px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line-soft); }
  .krow:last-child { border-bottom: 0; }
  .krow kbd { justify-self: start; }
</style>
