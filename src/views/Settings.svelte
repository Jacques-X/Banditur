<script>
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import WatermarkPacks from './marka/WatermarkPacks.svelte';
  import { marks, refreshPacks, markCount } from './marka/packs.svelte.js';
  import { app, toast, confirm, setTheme, setStudioDark, TOOLS, createProfile, renameProfileTo, deleteProfile, setProfile } from '../lib/app.svelte.js';
  import { health, runHealth } from '../lib/health.svelte.js';
  import { invoke } from '../lib/tauri.js';
  import { ago } from '../lib/format.js';
  import { UPD } from '../strings.js';
  import { upd, checkUpdates, startUpdate, busyNow } from '../lib/updates.svelte.js';
  import { buttonState, stateLines, updateState, commitLine } from '../lib/updates.js';

  let { active } = $props();
  const SECTIONS = [
    ['sistema', 'System'], ['profili', 'Profili'], ['dehra', 'Appearance'],
    ['marki', 'Watermarks'], ['aggornamenti', 'Components'], ['shortcuts', 'Shortcuts'],
  ];
  let packsOpen = $state(false);

  $effect(() => { if (active && app.settingsSection === 'sistema' && !health.running && Date.now() - health.at > 60000) untrack(runHealth); });
  $effect(() => { if (active && app.settingsSection === 'marki' && !marks.loaded) untrack(refreshPacks); });

  // ── Profiles (kept on this Mac: each one has its own Xogħol boards and Kalendarju) ──
  let newProfile = $state('');
  function addProfileNow() {
    const id = createProfile(newProfile);
    if (!id) return;
    newProfile = '';
    toast('Profil miżjud.', 'ok');
  }
  async function removeProfileNow(p) {
    if (!await confirm(`Tneħħi l-profil “${p.name}” mil-lista? Il-boards u l-kalendarju tiegħu jibqgħu miżmuma fuq dan il-Mac u jerġgħu jidhru jekk iżżid profil bl-istess id (“${p.id}”).`, { yes: 'Neħħi', no: 'Żomm', danger: true })) return;
    deleteProfile(p.id);
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
  const upTone = $derived({ error: 'warn', diverged: 'warn', behind: 'info', pending: 'info', current: 'ok' }[updateState(upd.status, { running: upd.running })] || 'info');
  let reloading = $state(false);
  async function reloadUi() {
    reloading = true;
    try { await invoke('reload_interface'); } catch { reloading = false; }
  }
  const FROM = { bundled: 'mill-app (verżjoni qadima)', dev: 'mill-proġett (żvilupp)', missing: 'mhix installata' };
  const pieceText = (source, version) => (source === 'installed' ? `verżjoni ${version ?? '?'}` : FROM[source] || '—');

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
          const text = [`Banditur ${app.version || '?'} · ${navigator.userAgent}`, ...health.checks.map(c => `[${c.tone}] ${c.name}: ${c.detail}${c.ver ? ` (${c.ver})` : ''}`)].join('\n');
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

    {:else if app.settingsSection === 'profili'}
      <div class="h"><h2>Profili</h2></div>
      <p class="help">Kull profil għandu l-boards ta’ Xogħol u l-kalendarju tiegħu. Jinżammu fuq dan il-Mac biss. Il-profil li qed taħdem fuqu hu fuq ix-xellug tal-bar ta’ fuq.</p>
      <div class="card list">
        {#each app.profiles as p (p.id)}
          <div class="prow">
            <input class="input pname" aria-label="Isem tal-profil {p.id}" value={p.name} maxlength="60"
                   onchange={e => { renameProfileTo(p.id, e.currentTarget.value); e.currentTarget.value = app.profiles.find(x => x.id === p.id)?.name || p.name; }} />
            <span class="mono muted small">{p.id}</span>
            {#if p.id === app.profileId}<span class="pill ok">Qed jintuża</span>{:else}<button class="btn sm" type="button" onclick={() => setProfile(p.id)}>Uża</button>{/if}
            <button class="btn ghost sm" type="button" disabled={app.profiles.length < 2} onclick={() => removeProfileNow(p)}>Neħħi</button>
          </div>
        {/each}
      </div>
      <form class="card form add" onsubmit={e => { e.preventDefault(); addProfileNow(); }}>
        <label class="label" for="np-name">Profil ġdid</label>
        <div class="actions"><input id="np-name" class="input" bind:value={newProfile} placeholder="Isem (eż. Żgħażagħ)" maxlength="60" /><button class="btn primary" type="submit" disabled={!newProfile.trim()}>Żid</button></div>
      </form>

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
        {#each [['0 – 2', 'Home, Kalendarju, Xogħol'], ...TOOLS.map(t => [`⌘${t.key}`, t.label]), ['⌘K', 'Mur fejn trid: screens, avvenimenti, proġetti'], ['⌘,', 'Settings'], ['Esc', 'Agħlaq dijalogu jew menu'], ['?', 'Ix-shortcuts tal-editur tas-subtitles']] as [k, d]}
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
  .pname { flex: 1; min-width: 0; }
  .add .actions .input { flex: 1; }
  .pieces { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 4px 0 10px; }
  .pieces dt { color: var(--muted); }
  .pieces dd { margin: 0; font-weight: 600; }
  .pieces dd.bad { color: var(--danger-fg); }
  .actions { display: flex; gap: 10px; align-items: center; }
  .commits { margin: 4px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .logtail { margin: 8px 0 0; max-height: 180px; overflow: auto; white-space: pre-wrap; font-family: var(--font-mono); font-size: 11px; background: var(--card); border: 1px solid var(--line); border-radius: 7px; padding: 8px; color: var(--fg); }
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
