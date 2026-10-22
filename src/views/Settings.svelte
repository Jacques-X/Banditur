<script>
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import WatermarkPacks from './marka/WatermarkPacks.svelte';
  import { marks, refreshPacks, markCount } from './marka/packs.svelte.js';
  import { app, ls, toast, confirm, saveConfig, setTheme, setStudioDark, setProfile, TOOLS } from '../lib/app.svelte.js';
  import { health, runHealth } from '../lib/health.svelte.js';
  import { refreshCounts } from '../lib/queue.svelte.js';
  import { checkForUpdate, invoke, isTauri } from '../lib/tauri.js';
  import { ago } from '../lib/format.js';
  import { clearSavedSessions, listRecentSessions } from '../subtitles/editor.js';
  import { TOAST } from '../strings.js';

  let { active } = $props();
  const SECTIONS = [
    ['sistema', 'Sistema'], ['konnessjoni', 'Konnessjoni'], ['profili', 'Profili'], ['dehra', 'Dehra'],
    ['marki', 'Marki (packs)'], ['traskrittura', 'Traskrittura'], ['aggornamenti', 'Aġġornamenti'], ['shortcuts', 'Shortcuts'],
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

  // ── Updates ───────────────────────────────────────────────────────────────
  let upd = $state({ busy: false, text: '' });
  async function checkUpdate() {
    upd = { busy: true, text: 'Qed niċċekkja…' };
    try {
      const u = await checkForUpdate({ timeout: 15000 });
      if (!isTauri) { upd = { busy: false, text: 'L-aġġornamenti jaħdmu biss fl-app.' }; return; }
      if (!u) { upd = { busy: false, text: 'Għandek l-aħħar verżjoni.' }; return; }
      const ok = await confirm(`Verżjoni ${u.version} disponibbli. Tinstallaha issa?${u.body ? `\n\n${u.body}` : ''}`, { yes: 'Installa', no: 'Aktar tard' });
      if (!ok) { upd = { busy: false, text: `Verżjoni ${u.version} disponibbli.` }; return; }
      let got = 0, total = 0;
      upd.text = `Qed iniżżel ${u.version}…`;
      await u.downloadAndInstall(ev => {
        if (ev.event === 'Started') total = ev.data.contentLength || 0;
        else if (ev.event === 'Progress') { got += ev.data.chunkLength; if (total) upd.text = `Qed iniżżel ${Math.round((got / total) * 100)}%…`; }
        else if (ev.event === 'Finished') upd.text = 'Installat. Qed terġa\' tiftaħ…';
      });
      await invoke('restart_app');
    } catch (e) {
      upd = { busy: false, text: `Ma setax jiċċekkja: ${String(e).split('\n')[0]}` };
    }
  }

  const tone = { ok: 'ok', warn: 'warn', error: 'danger' };
  let sessions = $state(listRecentSessions(50).length);
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
      <div class="h"><h2>Sistema</h2><span class="muted small">{health.at ? `iċċekkjat ${ago(health.at)}` : ''}</span><span class="spacer"></span>
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
            {#if c.fix}<button class="btn sm primary" type="button" onclick={() => (app.settingsSection = c.fix)}>{c.fix === 'aggornamenti' ? 'Aġġorna' : 'Irranġa'}</button>{/if}
          </div>
        {:else}
          <div class="empty">Qed niċċekkja…</div>
        {/each}
      </div>
      <p class="help">yt-dlp, ffmpeg u l-mudell tat-traskrizzjoni jiġu ċċekkjati meta tużahom: jekk xi ħaġa nieqsa, l-għodda tgħidlek x'għandek tagħmel.</p>

    {:else if app.settingsSection === 'konnessjoni'}
      <div class="h"><h2>Konnessjoni</h2></div>
      {#if app.configSource === 'app'}<div class="notice info">Din l-app diġà għandha l-konfigurazzjoni tal-kumitat inkluża. Biddel hawn biss jekk qalulek.</div>{/if}
      <form class="card form" onsubmit={e => { e.preventDefault(); saveConn(); }}>
        <div class="field"><label class="label" for="c-url">Backend URL</label><input id="c-url" class="input mono-in" bind:value={form.vercelUrl} placeholder="https://….vercel.app" autocomplete="off" spellcheck="false" /></div>
        <div class="field"><label class="label" for="c-key">API Key</label><input id="c-key" class="input mono-in" type={showKeys ? 'text' : 'password'} bind:value={form.apiKey} autocomplete="off" spellcheck="false" /></div>
        <div class="field"><label class="label" for="c-sb">Supabase URL</label><input id="c-sb" class="input mono-in" bind:value={form.supabaseUrl} placeholder="https://….supabase.co" autocomplete="off" spellcheck="false" /><span class="help">Għall-upload tar-ritratti u l-videos tal-posts.</span></div>
        <div class="field"><label class="label" for="c-sbk">Supabase anon key</label><input id="c-sbk" class="input mono-in" type={showKeys ? 'text' : 'password'} bind:value={form.supabaseKey} autocomplete="off" spellcheck="false" /></div>
        <label class="check"><input type="checkbox" bind:checked={showKeys} />Uri l-keys</label>
        <div class="actions"><button class="btn primary" type="submit">Issejvja u ċċekkja</button>{#if app.configSource === 'local'}<button class="btn ghost" type="button" onclick={resetConn}>Neħħi minn dan il-kompjuter</button>{/if}</div>
      </form>

    {:else if app.settingsSection === 'profili'}
      <div class="h"><h2>Profili</h2></div>
      <p class="help">Il-profili (paġni ta' Facebook u kontijiet ta' Instagram) jiġu mill-backend. Agħżel dak li taħdem fuqu — jidher ukoll fuq ix-xellug tal-bar ta' fuq.</p>
      <div class="card list">
        {#each app.profiles as p (p.id)}
          <label class="prow"><input type="radio" name="profile" checked={app.profileId === p.id} onchange={() => setProfile(p.id)} /><span><strong>{p.name || p.id}</strong><span class="mono muted"> {p.id}</span></span></label>
        {/each}
      </div>

    {:else if app.settingsSection === 'dehra'}
      <div class="h"><h2>Dehra</h2></div>
      <div class="themes" role="radiogroup" aria-label="Tema">
        {#each [['light', 'Ċar'], ['dark', 'Skur'], ['system', 'Bħall-Mac']] as [id, label]}
          <button type="button" role="radio" aria-checked={app.theme === id} class="theme" onclick={() => setTheme(id)}>
            <span class="sw {id}" aria-hidden="true"></span>{label}{app.theme === id ? ' ✓' : ''}
          </button>
        {/each}
      </div>
      <label class="check"><input type="checkbox" checked={app.studioDark} onchange={e => setStudioDark(e.currentTarget.checked)} />Traskrittura u Posts dejjem skuri — ir-ritratti u l-videos jidhru aħjar fuq sfond skur</label>

    {:else if app.settingsSection === 'marki'}
      <div class="h"><h2>Marki (packs)</h2><span class="spacer"></span><button class="btn primary" type="button" onclick={() => (packsOpen = true)}>Immaniġġja l-marki</button></div>
      <p class="help">Il-marki tal-fotografi ma jiġux mal-app: jiġu f'packs (.bwpack) li tinstalla hawn jew minn Marka &amp; Ssortja.</p>
      <div class="card list">
        {#each marks.packs as p (p.id)}
          <div class="prow"><span><strong>{p.name}</strong> <span class="muted small">· verżjoni {p.version} · {p.watermarks.length} marki</span></span></div>
        {:else}
          <div class="empty">{marks.loaded ? 'L-ebda pack installat.' : 'Qed jgħabbi…'}</div>
        {/each}
      </div>
      <p class="muted small">{markCount()} marki installati b'kollox.</p>

    {:else if app.settingsSection === 'traskrittura'}
      <div class="h"><h2>Traskrittura</h2></div>
      <div class="card form">
        <p>Il-bidliet fis-sottotitli jiġu ssejvjati waħedhom fuq dan il-kompjuter, biex tkompli minn fejn ħallejt. Bħalissa hemm <strong>{sessions}</strong> {sessions === 1 ? 'sessjoni' : 'sessjonijiet'}.</p>
        <div class="actions"><button class="btn" type="button" disabled={!sessions} onclick={async () => {
          if (!await confirm('Tħassar il-bidliet issejvjati kollha tas-sottotitli? Il-videos u l-fajls SRT ma jintmessux.', { yes: 'Ħassar', no: 'Żomm', danger: true })) return;
          clearSavedSessions(); sessions = 0; toast('Is-sessjonijiet tħassru.', 'ok'); }}>Ħassar is-sessjonijiet kollha</button></div>
      </div>
      <p class="help">Il-lingwa tat-traskrizzjoni hija l-Malti. L-istili, l-ismijiet u l-logo jinbidlu mill-editur stess (Stil · S).</p>

    {:else if app.settingsSection === 'aggornamenti'}
      <div class="h"><h2>Aġġornamenti</h2></div>
      <div class="card form">
        <p>Banditur <span class="mono">{app.version ? `v${app.version}` : ''}</span></p>
        <div class="actions"><button class="btn primary" type="button" disabled={upd.busy} onclick={checkUpdate}>Iċċekkja għal aġġornament</button><span class="muted">{upd.text}</span></div>
      </div>

    {:else}
      <div class="h"><h2>Shortcuts</h2></div>
      <div class="card keys">
        {#each [['1 – 4', 'Skeda, Kalendarju, L-Arkivju, Rapporti'], ...TOOLS.map(t => [`⌘${t.key}`, t.label]), ['⌘↵', 'Iskeda l-post (fi Skeda)'], ['⌘K', 'Fittex fl-Arkivju'], ['⌘,', 'Settings'], ['Esc', 'Agħlaq dijalogu jew menu'], ['?', 'Ix-shortcuts tal-editur tas-sottotitli']] as [k, d]}
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
  .actions { display: flex; gap: 10px; align-items: center; }
  .list { overflow: hidden; }
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
