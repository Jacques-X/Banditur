<script>
  // Kampanji view: 13 weeks across, one row per campaign. Each campaign is a bar over its days,
  // with the planned posts added to it per week against the target under it (orange when short, from this week on)
  // and a tick on every empty day still ahead. The last row is the whole profile's load per week.
  // Maths in campaigns.js.
  import { MONTHS_SHORT } from '../../lib/format.js';
  import { addDays, daysBetween } from './model.js';
  import { bar, campaignWeeks, emptyDays, perWeek, weeks as weeksOf } from './campaigns.js';

  // dated: every busy day (bottom row); datedFor(c): the days of what was added to campaign c.
  let { from, to, campaigns, dated, datedFor, today, onopen, onpick, oncreate } = $props();

  const total = $derived(daysBetween(from, to));
  const weeks = $derived(weeksOf(from, to));
  const pct = (days) => `${(days / total) * 100}%`;
  const short = (d) => `${+d.slice(8)} ${MONTHS_SHORT[+d.slice(5, 7) - 1]}`;
  const todayAt = $derived(today >= from && today < to ? daysBetween(from, today) : -1);
  const thisWeek = $derived(addDays(today, -6)); // a week ending before this is past

  const rows = $derived(
    campaigns
      .map((c) => ({ c, b: bar(c, from, to) }))
      .filter((r) => r.b)
      .sort((a, b) => (a.c.from < b.c.from ? -1 : 1))
      .map(({ c, b }) => {
        const mine = datedFor(c);
        const byWeek = new Map(campaignWeeks(c, mine).map((w) => [w.week, w]));
        return { c, b, weeks: weeks.map((w) => byWeek.get(w) || null), empty: emptyDays(c, mine, today).filter((d) => d >= from && d < to) };
      }),
  );
  const load = $derived(perWeek(weeks, dated));
  const most = $derived(Math.max(1, ...load));
  const months = $derived.by(() => {
    const out = [];
    for (const [i, w] of weeks.entries()) {
      const m = w.slice(0, 7);
      if (!out.length || out.at(-1).m !== m) out.push({ m, i, n: 1 }); else out.at(-1).n++;
    }
    return out;
  });
</script>

<div class="pv" style:--w={weeks.length}>
  <div class="row head">
    <div class="name"></div>
    <div class="track">
      <div class="months">{#each months as m (m.m)}<span style:grid-column="{m.i + 1} / span {m.n}">{MONTHS_SHORT[+m.m.slice(5) - 1]} {m.m.slice(0, 4)}</span>{/each}</div>
      <div class="weeks">{#each weeks as w (w)}<button type="button" class="wh" class:now={w <= today && today <= addDays(w, 6)} onclick={() => onpick(w, 'week')}>{+w.slice(8)}</button>{/each}</div>
    </div>
  </div>

  <div class="body">
    {#each rows as r (r.c.id)}
      <div class="row">
        <button class="name" type="button" onclick={() => onopen(r.c)}>
          <span class="sw" style:background={r.c.color}></span>
          <span class="nm"><b>{r.c.name}</b><span class="muted small">{short(r.c.from)} – {short(r.c.to)}{r.c.target ? ` · ${r.c.target}/ġimgħa` : ''}</span></span>
        </button>
        <div class="track">
          <div class="lane">
            <button class="bar" type="button" style:left={pct(r.b.left)} style:width={pct(r.b.width)} style:--c={r.c.color}
              class:cs={r.b.clippedStart} class:ce={r.b.clippedEnd} onclick={() => onopen(r.c)} title={r.c.goal || r.c.name}>{r.c.name}</button>
            {#each r.empty as d (d)}<span class="tick" style:left={pct(daysBetween(from, d) + 0.5)} title="{short(d)}: xejn ippjanat"></span>{/each}
            {#if todayAt >= 0}<span class="today" style:left={pct(todayAt)}></span>{/if}
          </div>
          <div class="weeks">
            {#each r.weeks as w, i (weeks[i])}
              {#if w}
                <button type="button" class="wc" class:short={w.short && w.week >= thisWeek} class:past={w.week < thisWeek} onclick={() => onpick(w.week < r.c.from ? r.c.from : w.week, 'week')}
                  title="{w.count} {w.count === 1 ? 'post' : 'posts'}{w.need ? ` minn ${w.need}` : ''}">{w.count}{w.need ? `/${w.need}` : ''}</button>
              {:else}<span></span>{/if}
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="empty">
        <p class="muted">L-ebda kampanja f’dawn it-13-il ġimgħa.</p>
        <button class="btn" type="button" onclick={oncreate}>+ Kampanja</button>
      </div>
    {/each}
  </div>

  <div class="row foot">
    <div class="name"><span class="muted small">Posts ippjanati kollha<br />fil-ġimgħa</span></div>
    <div class="track">
      <div class="weeks loads">
        {#each load as n, i (weeks[i])}
          <button type="button" class="ld" onclick={() => onpick(weeks[i], 'week')} title="{n} fil-ġimgħa ta’ {short(weeks[i])}">
            <span class="col" style:height="calc((100% - 16px) * {n / most})"></span><span class="mono">{n}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .pv { flex: 1; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 10px; background: var(--card); overflow: hidden; }
  .body { flex: 1; min-height: 0; overflow-y: auto; }
  .row { display: grid; grid-template-columns: 190px 1fr; border-bottom: 1px solid var(--line); }
  .row.head { background: var(--bg-sunken); }
  .row.foot { border-bottom: 0; border-top: 1px solid var(--line); background: var(--bg-sunken); }
  .name { all: unset; box-sizing: border-box; display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-right: 1px solid var(--line); min-width: 0; }
  button.name { cursor: pointer; }
  button.name:hover { background: var(--hover); }
  .nm { display: flex; flex-direction: column; min-width: 0; font-size: 13px; }
  .nm b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .track { min-width: 0; display: flex; flex-direction: column; }
  .months, .weeks { display: grid; grid-template-columns: repeat(var(--w), 1fr); }
  .months span { font-size: 11px; font-weight: 600; color: var(--muted); padding: 4px 6px 0; border-left: 1px solid var(--line); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; overflow: hidden; }
  .wh { all: unset; font-size: 11px; color: var(--muted); padding: 2px 6px 4px; cursor: pointer; font-family: var(--font-mono); }
  .wh:hover { color: var(--fg); }
  .wh.now { color: var(--accent); font-weight: 700; }
  .lane { position: relative; height: 30px; margin-top: 6px; }
  .bar { all: unset; box-sizing: border-box; position: absolute; top: 3px; height: 24px; padding: 0 8px; border-radius: 6px; background: color-mix(in srgb, var(--c) 22%, transparent); border: 1px solid color-mix(in srgb, var(--c) 60%, transparent); border-left: 4px solid var(--c); font-size: 12px; font-weight: 600; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; color: var(--fg); }
  .bar:hover { background: color-mix(in srgb, var(--c) 32%, transparent); }
  .bar.cs { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-style: dashed; }
  .bar.ce { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .tick { position: absolute; bottom: -2px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--warn); }
  .today { position: absolute; top: -6px; bottom: -40px; width: 2px; margin-left: -1px; background: var(--accent); opacity: .6; pointer-events: none; }
  .weeks .wc { all: unset; box-sizing: border-box; text-align: center; font-family: var(--font-mono); font-size: 11px; padding: 3px 0; margin: 4px 2px 6px; border-radius: 5px; background: var(--bg-sunken); cursor: pointer; }
  .weeks .wc:hover { outline: 1px solid var(--line-strong); }
  .wc.short { background: var(--warn-bg); color: var(--warn-fg); font-weight: 700; }
  .wc.past { opacity: .5; }
  .loads { height: 58px; align-items: end; }
  .ld { all: unset; box-sizing: border-box; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; padding: 6px 4px 4px; cursor: pointer; }
  .ld .col { width: 60%; min-height: 2px; border-radius: 3px 3px 0 0; background: var(--accent); opacity: .7; }
  .ld:hover .col { opacity: 1; }
  .mono { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
  .empty { padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
</style>
