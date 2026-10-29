<script>
  import { maltaWall } from '../lib/malta-time.js';
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { app, toast, configured } from '../lib/app.svelte.js';
  import { api } from '../lib/api.js';
  import { isMock } from '../lib/tauri.js';
  import { toDateInput, addDays, longDate, MONTHS_SHORT, num } from '../lib/format.js';
  import { platformById } from '../platforms.js';
  import { REPORT, STATUS_LABELS, ERR } from '../strings.js';
  import { escapeHtml as esc } from '../ui.js';

  let { active } = $props();

  // ── Period ────────────────────────────────────────────────────────────────
  const PRESETS = [
    ['last-7', '7 ijiem'], ['this-month', 'Dan ix-xahar'], ['last-month', 'Ix-xahar li għadda'],
    ['this-quarter', 'Dan il-kwart'], ['this-year', 'Din is-sena'], ['custom', 'Ieħor…'],
  ];
  function range(key) {
    const n = new Date();
    switch (key) {
      case 'last-7': return [addDays(n, -6), n];
      case 'last-month': return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)];
      case 'this-quarter': { const q = Math.floor(n.getMonth() / 3) * 3; return [new Date(n.getFullYear(), q, 1), new Date(n.getFullYear(), q + 3, 0)]; }
      case 'this-year': return [new Date(n.getFullYear(), 0, 1), new Date(n.getFullYear(), 11, 31)];
      default: return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)];
    }
  }
  let category=$state(''), eventId=$state('');
  let preset = $state('this-month');
  let from = $state(toDateInput(range('this-month')[0]));
  let to = $state(toDateInput(range('this-month')[1]));
  let compareOn = $state(false);
  let cFrom = $state('');
  let cTo = $state('');
  function pick(key) {
    preset = key;
    if (key !== 'custom') { const [a, b] = range(key); from = toDateInput(a); to = toDateInput(b); }
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  let data = $state(null);
  let loading = $state(false);
  let error = $state('');
  let token = 0;
  async function load() {
    if (!configured() && !isMock()) { error = ERR.vercel_config; return; }
    if (!from || !to) return;
    if (from > to) { error = ERR.bad_range; return; }
    if (compareOn && (!cFrom || !cTo || cFrom > cTo)) { error = 'Agħżel perijodu validu biex tqabbel miegħu.'; return; }
    const my = ++token;
    loading = true; error = '';
    try {
      const r = await api('/api/reports/monthly', { query: { from, to, category, event_id:eventId, profile_id: app.profileId, compare_from: compareOn ? cFrom : '', compare_to: compareOn ? cTo : '' } });
      if (my === token) data = r;
    } catch (e) { if (my === token) { error = e.message; data = null; } }
    if (my === token) loading = false;
  }
  $effect(() => { if (active) { app.profileId; from; to; category; eventId; compareOn; cFrom; cTo; untrack(load); } });

  const prev = $derived(data?.previous);
  function delta(cur, before) {
    if(cur==null || before==null) return null;
    cur = Number(cur) || 0; before = Number(before) || 0;
    if (!prev) return null;
    if (!before) return cur ? { text: 'ġdid', up: true } : null;
    const pct = Math.round(((cur - before) / before) * 100);
    return { text: pct === 0 ? '±0%' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct >= 0, flat: pct === 0 };
  }
  const kpis = $derived(data ? [
    { label: 'Posts ippubblikati', value: num(data.summary?.total_published), d: delta(data.summary?.total_published, prev?.summary?.total_published) },
    { label: 'Likes', value: num(data.engagement?.total_likes), d: delta(data.engagement?.total_likes, prev?.engagement?.total_likes) },
    { label: 'Comments', value: num(data.engagement?.total_comments), d: delta(data.engagement?.total_comments, prev?.engagement?.total_comments) },
    { label: 'Engagement għal kull post', value: num(data.engagement?.avg_per_post), d: delta(data.engagement?.avg_per_post, prev?.engagement?.avg_per_post) },
    { label: 'Posts fil-ġimgħa', value: num(data.summary?.posts_per_week), d: delta(data.summary?.posts_per_week, prev?.summary?.posts_per_week) },
  ] : []);

  // Engagement (likes + comments) per week of the period, from the published posts.
  const weeks = $derived.by(() => {
    if (!data?.posts) return [];
    const start = new Date(`${from}T00:00:00`), end = new Date(`${to}T23:59:59`);
    const out = [];
    for (let s = new Date(start); s <= end; s = addDays(s, 7)) {
      const e = addDays(s, 7);
      const ps = data.posts.filter(p => { const t = new Date(maltaWall(p.scheduled_time)); return t >= s && t < e; });
      const last = addDays(e, -1) > end ? end : addDays(e, -1);
      out.push({ label: `${s.getDate()}${s.getMonth() !== last.getMonth() ? ` ${MONTHS_SHORT[s.getMonth()]}` : ''}–${last.getDate()} ${MONTHS_SHORT[last.getMonth()]}`,
        value: ps.some(p=>p.likes_count!=null && p.comments_count!=null) ? ps.reduce((n, p) => n + (p.likes_count || 0) + (p.comments_count || 0), 0) : null, posts: ps.length });
      if (out.length > 26) break;
    }
    const max = Math.max(1, ...out.map(w => w.value));
    return out.map(w => ({ ...w, pct: Math.round((w.value / max) * 100) }));
  });
  const top = $derived([...(data?.posts || [])].filter(p=>p.likes_count!=null && p.comments_count!=null).sort((a, b) => ((b.likes_count || 0) + (b.comments_count || 0)) - ((a.likes_count || 0) + (a.comments_count || 0))).slice(0, 5));
  const platforms = $derived([...new Set([...Object.keys(data?.summary?.by_platform || {}), ...Object.keys(prev?.summary?.by_platform || {})])]);

  // ── Export ────────────────────────────────────────────────────────────────
  let exportOpen = $state(false);
  let sections = $state({ posts: true, engage: true, trends: true, followers: true, reach: true, top: true, list: true });
  const SECTION_LABELS = { posts: 'Numru ta\' posts', engage: 'Likes u kummenti', trends: 'Tqabbil mal-perijodu ta\' qabel', followers: 'Followers', reach: 'Reach (impressions)', top: 'L-aqwa posts', list: 'Lista sħiħa tal-posts' };

  function reportHtml() {
    const d = data, p = prev, s = sections;
    const fmt = x => longDate(new Date(`${x}T12:00:00`));
    const dl = (a, b) => { const r = delta(a, b); return r ? (r.flat ? '±0%' : `${r.up ? '▲' : '▼'} ${r.text}`) : '—'; };
    let h = `<div class="rp-head"><div class="rp-org">${esc(REPORT.org)}</div><div class="rp-dept">${esc(REPORT.dept)}</div></div>
      <h1>${esc(REPORT.title)}</h1><p class="rp-period">${esc(REPORT.period(fmt(from), fmt(to)))}</p>`;
    const table = (rows, head = '') => `<table>${head}${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(String(c ?? '—'))}</td>`).join('')}</tr>`).join('')}</table>`;
    if (s.posts && d.summary) h += `<h2>${esc(REPORT.sec_posts)}</h2>` + table([
      [REPORT.total_pub, d.summary.total_published], [REPORT.total_pend, d.summary.total_pending], [REPORT.total_fail, d.summary.total_failed],
      [REPORT.trend_perweek, d.summary.posts_per_week], ...Object.entries(d.summary.by_platform || {}).map(([k, v]) => [`→ ${platformById(k)?.label || k}`, v]),
    ]);
    if (s.engage && d.engagement) h += `<h2>${esc(REPORT.sec_engage)}</h2>` + table([[REPORT.total_likes, d.engagement.total_likes], [REPORT.total_comm, d.engagement.total_comments], [REPORT.trend_avg, d.engagement.avg_per_post]]);
    if (s.trends && p) h += `<h2>${esc(REPORT.sec_trends)}</h2><p class="rp-sub">${esc(REPORT.trend_period(fmt(p.range.from), fmt(p.range.to)))}</p>` + table([
      [REPORT.total_pub, d.summary?.total_published, p.summary?.total_published, dl(d.summary?.total_published, p.summary?.total_published)],
      [REPORT.total_likes, d.engagement?.total_likes, p.engagement?.total_likes, dl(d.engagement?.total_likes, p.engagement?.total_likes)],
      [REPORT.total_comm, d.engagement?.total_comments, p.engagement?.total_comments, dl(d.engagement?.total_comments, p.engagement?.total_comments)],
      [REPORT.trend_avg, d.engagement?.avg_per_post, p.engagement?.avg_per_post, dl(d.engagement?.avg_per_post, p.engagement?.avg_per_post)],
      [REPORT.trend_perweek, d.summary?.posts_per_week, p.summary?.posts_per_week, dl(d.summary?.posts_per_week, p.summary?.posts_per_week)],
      ...platforms.map(k => [REPORT.trend_plat(platformById(k)?.label || k), d.summary?.by_platform?.[k] || 0, p.summary?.by_platform?.[k] || 0, dl(d.summary?.by_platform?.[k], p.summary?.by_platform?.[k])]),
    ], '<tr><th></th><th>Issa</th><th>Qabel</th><th>Bidla</th></tr>');
    const pi = d.page_insights;
    if ((s.followers || s.reach) && pi) {
      const rows = [];
      if (s.followers) { rows.push([REPORT.fb_followers, pi.fb_followers], [REPORT.ig_followers, pi.ig_followers]); if (pi.fb_follower_change != null) rows.push([REPORT.fb_foll_chg, `${pi.fb_follower_change > 0 ? '+' : ''}${pi.fb_follower_change}`]); }
      if (s.reach) rows.push([REPORT.fb_impr, pi.fb_impressions]);
      h += `<h2>${esc(REPORT.sec_reach)}</h2>` + table(rows);
    }
    const postRows = list => list.map(x => [new Date(x.scheduled_time).toLocaleDateString('mt'), (x.caption || '').slice(0, 60), (x.platforms || []).join(', '), x.likes_count ?? '—', x.comments_count ?? '—']);
    if (s.top && top.length) h += `<h2>${esc(REPORT.sec_top(top.length))}</h2>` + table(postRows(top), '<tr><th>Data</th><th>Caption</th><th>Fejn</th><th>Likes</th><th>Comments</th></tr>');
    if (s.list && d.posts?.length) h += `<h2>${esc(REPORT.sec_list(d.posts.length))}</h2>` + table(d.posts.map(x => [new Date(x.scheduled_time).toLocaleDateString('mt'), (x.caption || '').slice(0, 60), (x.platforms || []).join(', '), STATUS_LABELS[x.status] || x.status, x.likes_count ?? '—', x.comments_count ?? '—']), '<tr><th>Data</th><th>Caption</th><th>Fejn</th><th>Status</th><th>Likes</th><th>Comments</th></tr>');
    h += `<p class="rp-sub">${esc(d.generated_at || '')} · ${d.engagement?.measured_posts ?? 0}/${d.engagement?.total_posts ?? 0} posts b’kejl. Followers: għadd attwali. Engagement: l-aħħar kejl disponibbli.</p><p class="rp-foot">${esc(REPORT.footer(new Date().toLocaleString('mt')))}</p>`;
    return h;
  }
  function exportPdf() {
    if (!data) { toast(ERR.no_report_yet, 'warn'); return; }
    exportOpen = false;
    const area = document.createElement('div');
    area.id = 'print-area';
    area.innerHTML = reportHtml();
    document.body.appendChild(area);
    window.print();   // the macOS print dialog has "Save as PDF"
    area.remove();
  }
  function exportCsv() {
    if (!data) { toast(ERR.no_report_yet, 'warn'); return; }
    exportOpen = false;
    const d = data, p = prev, s = sections;
    const rows = [[REPORT.title], ['Perijodu', from, to],['Ġenerat',d.generated_at || ''],['Posts b’kejl',d.engagement?.measured_posts ?? 0,d.engagement?.total_posts ?? 0],['Followers','Għadd attwali'],['Engagement','L-aħħar kejl disponibbli']];
    if (p?.range) rows.push(["Imqabbel ma'", p.range.from, p.range.to]);
    rows.push([]);
    if (s.posts && d.summary) {
      rows.push(['Posts', 'Issa', p ? 'Qabel' : '']);
      rows.push([REPORT.total_pub, d.summary.total_published, p?.summary?.total_published ?? '']);
      rows.push([REPORT.total_pend, d.summary.total_pending, ''], [REPORT.total_fail, d.summary.total_failed, '']);
      rows.push([REPORT.trend_perweek, d.summary.posts_per_week, p?.summary?.posts_per_week ?? '']);
      platforms.forEach(k => rows.push([REPORT.trend_plat(k), d.summary.by_platform?.[k] ?? 0, p?.summary?.by_platform?.[k] ?? '']));
      rows.push([]);
    }
    if (s.engage && d.engagement) {
      rows.push(['Engagement', 'Issa', p ? 'Qabel' : '']);
      rows.push([REPORT.total_likes, d.engagement.total_likes, p?.engagement?.total_likes ?? '']);
      rows.push([REPORT.total_comm, d.engagement.total_comments, p?.engagement?.total_comments ?? '']);
      rows.push([REPORT.trend_avg, d.engagement.avg_per_post, p?.engagement?.avg_per_post ?? '']);
      rows.push([]);
    }
    if ((s.followers || s.reach) && d.page_insights) {
      const pi = d.page_insights, ppi = p?.page_insights;
      rows.push([REPORT.sec_reach, 'Issa', p ? 'Qabel' : '']);
      if (s.followers) rows.push([REPORT.fb_followers, pi.fb_followers ?? '', ''], [REPORT.ig_followers, pi.ig_followers ?? '', ''], [REPORT.fb_foll_chg, pi.fb_follower_change ?? '', ppi?.fb_follower_change ?? '']);
      if (s.reach) rows.push([REPORT.fb_impr, pi.fb_impressions ?? '', ppi?.fb_impressions ?? '']);
      rows.push([]);
    }
    if (s.top && top.length) {
      rows.push([REPORT.sec_top(top.length)], ['Data', 'Caption', 'Platforms', 'Likes', 'Comments']);
      top.forEach(x => rows.push([x.scheduled_time, x.caption || '', (x.platforms || []).join('/'), x.likes_count ?? '—', x.comments_count ?? '—']));
      rows.push([]);
    }
    if (s.list && d.posts?.length) {
      rows.push([REPORT.sec_list(d.posts.length)], ['Data', 'Caption', 'Platforms', 'Profile', 'Status', 'Likes', 'Comments']);
      d.posts.forEach(x => rows.push([x.scheduled_time, x.caption || '', (x.platforms || []).join('/'), x.profile_id || 'main', STATUS_LABELS[x.status] || x.status, x.likes_count ?? '—', x.comments_count ?? '—']));
    }
    const cell = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rapport_${from}_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
</script>

<svelte:window onclick={e => { if (exportOpen && !e.target.closest?.('.export')) exportOpen = false; }} />

<div class="rap scroll">
  <div class="page-head">
    <h1>Rapporti</h1>
    <div class="seg" role="group" aria-label="Perijodu">
      {#each PRESETS as [k, l]}<button type="button" aria-pressed={preset === k} onclick={() => pick(k)}>{l}</button>{/each}
    </div>
    <span class="spacer"></span>
    <button class="btn icon" type="button" aria-label="Refresh" title="Refresh" onclick={load}><Icon name="refresh" size={15} /></button>
    <div class="export">
      <button class="btn primary" type="button" aria-expanded={exportOpen} disabled={!data} onclick={() => (exportOpen = !exportOpen)}>Export<Icon name="chevron" size={13} /></button>
      {#if exportOpen}
        <div class="pop" role="dialog" aria-label="Export ir-rapport">
          <div class="pop-h">X'jidħol fir-rapport</div>
          {#each Object.keys(sections) as k}<label class="check"><input type="checkbox" bind:checked={sections[k]} />{SECTION_LABELS[k]}</label>{/each}
          <div class="pop-actions">
            <button class="btn" type="button" onclick={exportCsv}>CSV</button>
            <button class="btn primary" type="button" onclick={exportPdf}>PDF…</button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if category || eventId}<p class="muted small">Il-filtri japplikaw għall-posts. Il-followers u l-impressions tal-paġna jkopru l-profil kollu.</p>{/if}
  <div class="ranges"><input class="input" aria-label="Kategorija" placeholder="Il-kategoriji kollha" bind:value={category}/><input class="input" aria-label="Avveniment" placeholder="L-avvenimenti kollha" bind:value={eventId}/><span class="muted small">{data?.generated_at ? `Aġġornat: ${new Date(data.generated_at).toLocaleString('mt-MT')}` : ''} · {data?.engagement?.measured_posts ?? '—'} minn {data?.engagement?.total_posts ?? '—'} posts b’metriċi · Followers: għadd attwali · —: mhux disponibbli</span></div>
  <div class="ranges">
    {#if preset === 'custom'}
      <label class="rng">Mill-<input class="input" type="date" bind:value={from} /></label>
      <label class="rng">Sa<input class="input" type="date" bind:value={to} /></label>
    {:else}
      <span class="muted">{longDate(new Date(`${from}T12:00:00`))} – {longDate(new Date(`${to}T12:00:00`))}</span>
    {/if}
    <span class="dot muted">·</span>
    <label class="check"><input type="checkbox" bind:checked={compareOn} />Qabbel ma' perijodu ieħor</label>
    {#if compareOn}
      <input class="input" type="date" bind:value={cFrom} aria-label="Tqabbil mill-" />
      <input class="input" type="date" bind:value={cTo} aria-label="Tqabbil sa" />
    {:else if prev?.range}
      <span class="muted small">imqabbel ma' {longDate(new Date(`${prev.range.from}T12:00:00`))} – {longDate(new Date(`${prev.range.to}T12:00:00`))}</span>
    {/if}
    {#if loading}<span class="muted small">Qed jgħabbi…</span>{/if}
  </div>

  {#if error}
    <div class="notice danger" role="alert">{error}</div>
  {:else if data}
    <div class="kpis">
      {#each kpis as k}
        <div class="card kpi">
          <span class="muted small">{k.label}</span>
          <span class="val tnum">{k.value}</span>
          <span class="mono d" class:up={k.d?.up && !k.d?.flat} class:down={k.d && !k.d.up}>{k.d ? k.d.text : ' '}</span>
        </div>
      {/each}
    </div>

    <div class="mid">
      <section class="card chart" aria-label="Engagement kull ġimgħa">
        <div class="ch-h"><strong>Engagement kull ġimgħa</strong><span class="muted small">likes + kummenti fuq il-posts ippubblikati</span></div>
        {#if weeks.some(w => w.value)}
          <div class="bars">
            {#each weeks as w}
              <div class="col" title="{w.label}: {num(w.value)} engagement minn {w.posts} posts">
                <span class="v mono">{w.value==null?'—':w.value ? num(w.value) : ''}</span>
                <span class="b" style="height: {Math.max(w.pct, w.value ? 3 : 0)}%"></span>
              </div>
            {/each}
          </div>
          <div class="xl">{#each weeks as w}<span class="mono">{w.label}</span>{/each}</div>
        {:else}
          <div class="empty">L-ebda engagement f'dan il-perijodu.</div>
        {/if}
      </section>
      <section class="card topp" aria-label="L-aħjar posts">
        <strong>L-aħjar posts</strong>
        {#each top as p, i (p.id || i)}
          <div class="tp">
            <span class="mono muted">{i + 1}</span>
            <span class="tp-t"><span class="truncate">{(p.caption || '').split('\n')[0]}</span><span class="mono muted">{new Date(p.scheduled_time).getDate()} {MONTHS_SHORT[new Date(p.scheduled_time).getMonth()]} · {(p.platforms || []).map(x => platformById(x)?.short || x).join(' ')}</span></span>
            <span class="mono">{num(p.likes_count==null || p.comments_count==null ? null : p.likes_count+p.comments_count)}</span>
          </div>
        {:else}
          <p class="muted small">L-ebda post ippubblikat f'dan il-perijodu.</p>
        {/each}
      </section>
    </div>

    <div class="row3">
      <div class="card stat"><span class="muted">Followers Facebook</span><span class="tnum sv">{num(data.page_insights?.fb_followers)}</span>{#if data.page_insights?.fb_follower_change != null}<span class="mono" class:up={data.page_insights.fb_follower_change > 0} class:down={data.page_insights.fb_follower_change < 0}>{data.page_insights.fb_follower_change > 0 ? '+' : ''}{data.page_insights.fb_follower_change}</span>{/if}</div>
      <div class="card stat"><span class="muted">Followers Instagram</span><span class="tnum sv">{num(data.page_insights?.ig_followers)}</span></div>
      <div class="card stat"><span class="muted">Impressions Facebook</span><span class="tnum sv">{num(data.page_insights?.fb_impressions)}</span>{#if prev?.page_insights?.fb_impressions}{@const dd = delta(data.page_insights?.fb_impressions, prev.page_insights.fb_impressions)}<span class="mono" class:up={dd?.up && !dd?.flat} class:down={dd && !dd.up}>{dd?.text}</span>{/if}</div>
    </div>
    {#if platforms.length}
      <p class="muted small">Posts skont il-platform: {platforms.map(k => `${platformById(k)?.label || k} ${data.summary?.by_platform?.[k] || 0}${prev ? ` (qabel ${prev.summary?.by_platform?.[k] || 0})` : ''}`).join(' · ')}</p>
    {/if}
  {:else if loading}
    <div class="empty">Qed jinġabar ir-rapport…</div>
  {/if}
</div>

<style>
  .rap { flex: 1; padding: 20px 40px 28px; display: flex; flex-direction: column; gap: 16px; }
  .ranges { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 34px; }
  .rng { display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .ranges .input { height: 30px; }
  .export { position: relative; }
  .pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: 280px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-pop); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .pop-h { font-weight: 600; }
  .pop-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
  .kpi { padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .val { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .up { color: var(--ok-fg); }
  .down { color: var(--danger-fg); }
  .d { min-height: 14px; color: var(--muted); }
  .d.up { color: var(--ok-fg); } .d.down { color: var(--danger-fg); }
  .mid { display: flex; gap: 16px; min-height: 300px; }
  .chart { flex: 1; min-width: 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .ch-h { display: flex; align-items: baseline; gap: 10px; }
  .bars { flex: 1; min-height: 180px; display: flex; gap: 18px; align-items: flex-end; padding: 0 8px; border-bottom: 1px solid var(--line); }
  .col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
  .b { width: min(56px, 70%); background: var(--accent); border-radius: 4px 4px 0 0; }
  .v { color: var(--muted); font-size: 11px; }
  .xl { display: flex; gap: 18px; padding: 0 8px; }
  .xl span { flex: 1; text-align: center; font-size: 11px; color: var(--muted); }
  .topp { width: 420px; flex-shrink: 0; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
  .tp { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line-soft); }
  .tp-t { display: flex; flex-direction: column; min-width: 0; }
  .row3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .stat { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
  .stat .sv { margin-left: auto; font-weight: 700; }
  @media (max-width: 1240px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } .topp { width: 340px; } }

  /* Printing the report (Esporta → PDF). Everything but #print-area is hidden. */
  @media print {
    :global(body > *:not(#print-area)) { display: none !important; }
    :global(body) { overflow: visible !important; background: #fff !important; }
  }
  :global(#print-area) { display: none; }
  @media print {
    :global(#print-area) { display: block; color: #111; font: 11pt/1.45 Inter, sans-serif; }
    :global(#print-area h1) { font-size: 20pt; margin: 6pt 0; }
    :global(#print-area h2) { font-size: 13pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
    :global(#print-area table) { width: 100%; border-collapse: collapse; }
    :global(#print-area td), :global(#print-area th) { padding: 3pt 6pt; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
    :global(#print-area td.n) { text-align: right; font-variant-numeric: tabular-nums; }
    :global(#print-area .rp-org) { font-weight: 700; font-size: 13pt; }
    :global(#print-area .rp-dept), :global(#print-area .rp-period), :global(#print-area .rp-sub), :global(#print-area .rp-foot) { color: #555; }
    :global(#print-area .rp-foot) { margin-top: 18pt; font-size: 9pt; }
  }
</style>
