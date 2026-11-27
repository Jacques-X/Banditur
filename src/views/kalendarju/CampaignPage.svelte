<script>
  // One campaign at a glance, in Kalendarju's side panel: its days and goal, its planned posts,
  // each week against the target, and the empty days still ahead (each one click away from a new
  // planned post). Everything counts by link: a planned post is in the campaign once it names it,
  // whatever its date and status.
  import Icon from '../../components/Icon.svelte';
  import { MONTHS_SHORT } from '../../lib/format.js';
  import { campaignWeeks, emptyDays, runs, STATUS_NAMES, mix, perPlatform, byOwner, dueOf } from './campaigns.js';
  import { platformById } from '../../platforms.js';
  import { addDays, daysBetween } from './model.js';

  let { campaign, slots, events, today, filtered, onedit, onclose, onfilter, onpick, onnewslot, onopenslot } = $props();

  const short = (d) => `${+d.slice(8)} ${MONTHS_SHORT[+d.slice(5, 7) - 1]}`;
  const length = $derived(daysBetween(campaign.from, campaign.to) + 1);

  const mine = $derived(slots.filter((s) => s.campaign === campaign.id).sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1)));
  const linkedEvents = $derived(events.filter((e) => e.campaign === campaign.id));
  // What the campaign has: its planned posts, whatever their status.
  const dated = $derived(mine.map((s) => s.day));
  const types = $derived(mix(mine));
  const topType = $derived(Math.max(1, ...types.map((t) => t.count)));
  const plats = $derived(Object.entries(perPlatform(mine)).sort((a, b) => b[1] - a[1]));
  const people = $derived(byOwner(mine, today));
  const weekRows = $derived(campaignWeeks(campaign, dated));
  const gaps = $derived(runs(emptyDays(campaign, dated, today)));
  const byStatus = $derived(['idea', 'draft', 'ready', 'done'].map((st) => [st, mine.filter((s) => s.status === st).length]));
  const phase = $derived(today < campaign.from ? `Tibda fi ${daysBetween(today, campaign.from)} ijiem` : today > campaign.to ? 'Għaddiet' : `Jum ${daysBetween(campaign.from, today) + 1} minn ${length}`);
</script>

<div class="cp">
  <div class="cp-h">
    <span class="sw" style:background={campaign.color}></span>
    <h2>{campaign.name}</h2>
    <button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={onclose}><Icon name="x" /></button>
  </div>
  <div class="muted small">{short(campaign.from)} – {short(campaign.to)} {campaign.to.slice(0, 4)} · {length} {length === 1 ? 'jum' : 'ijiem'} · {phase}</div>
  {#if campaign.goal}<p class="goal"><Icon name="flag" size={13} /> {campaign.goal}</p>{/if}

  <div class="acts">
    <button class="btn sm" type="button" onclick={onedit}><Icon name="pen" size={13} />Editja</button>
    <button class="btn sm" type="button" aria-pressed={filtered} onclick={onfilter}>{filtered ? 'Uri kollox' : 'Uri biss din'}</button>
    <button class="btn sm" type="button" onclick={() => onnewslot(today > campaign.from && today <= campaign.to ? today : campaign.from)}><Icon name="plus" size={13} />Ippjana post</button>
  </div>

  <div class="stats">
    <div><b>{mine.length}</b><span>ippjanati</span></div>
    {#each byStatus as [st, n]}<div><b>{n}</b><span>{STATUS_NAMES[st].toLowerCase()}</span></div>{/each}
    <div><b>{linkedEvents.length}</b><span>avvenimenti</span></div>
  </div>

  <div class="sec">
    <div class="sec-h">Kull ġimgħa{campaign.target ? ` · mira ${campaign.target}` : ''}</div>
    {#each weekRows as w (w.week)}
      <button class="wk" type="button" class:short={w.short && addDays(w.week, 6) >= today} class:past={addDays(w.week, 6) < today} onclick={() => onpick(w.week < campaign.from ? campaign.from : w.week, 'week')}>
        <span class="mono muted">{short(w.week < campaign.from ? campaign.from : w.week)}</span>
        <span class="meter"><span style:width="{Math.min(100, (w.count / Math.max(w.need, w.count, 1)) * 100)}%" style:background={campaign.color}></span></span>
        <span class="mono">{w.count}{w.need ? `/${w.need}` : ''}</span>
      </button>
    {/each}
  </div>

  <div class="sec">
    <div class="sec-h">Ijiem vojta li ġejjin</div>
    {#each gaps as [a, b] (a)}
      <div class="gap">
        <button class="link small" type="button" onclick={() => onpick(a, 'month')}>{a === b ? short(a) : `${short(a)} – ${short(b)}`}</button>
        <span class="muted small">{daysBetween(a, b) + 1} {a === b ? 'jum' : 'ijiem'}</span>
        <button class="link small" type="button" onclick={() => onnewslot(a)}>+ ippjana</button>
      </div>
    {:else}
      <p class="muted small">{today > campaign.to ? 'Il-kampanja għaddiet.' : 'Kull jum li ġej għandu xi ħaġa.'}</p>
    {/each}
  </div>

  <div class="sec">
    <div class="sec-h">Posts ippjanati ({mine.length})</div>
    {#each mine as s (s.id)}
      <button class="ev" type="button" onclick={() => onopenslot(s)}>
        <span class="mono muted">{short(s.day)}{s.time ? ` ${s.time}` : ''}</span><span class="truncate">{s.title}{#if s.owner}<span class="muted small">&nbsp;· {s.owner}</span>{/if}</span>{#if s.status !== 'ready' && s.status !== 'done' && dueOf(s) < today}<span class="pill danger">Tard</span>{/if}<span class="pill {s.status === 'ready' ? 'ok' : s.status === 'draft' ? 'meta' : s.status === 'done' ? 'meta' : ''}">{STATUS_NAMES[s.status]}</span>
      </button>
    {:else}
      <p class="muted small">Xejn ippjanat s’issa.</p>
    {/each}
  </div>
  <div class="sec">
    <div class="sec-h">Taħlita <span class="muted">· posts ippjanati</span></div>
    {#each types as t (t.name)}
      <div class="mx" class:none={!t.name}>
        <span class="truncate">{t.name || 'Bla tip'}</span>
        <span class="meter"><span style:width="{(t.count / topType) * 100}%" style:background={t.name ? campaign.color : 'var(--line-strong)'}></span></span>
        <span class="mono">{t.count}</span>
      </div>
    {:else}
      <p class="muted small">Xejn s’issa.</p>
    {/each}
    {#if plats.length}
      <div class="plats">{#each plats as [id, n] (id)}<span class="pill">{platformById(id)?.short || id} {n}</span>{/each}</div>
    {/if}
    {#if types.length && types.every((t) => t.name && t.count === mine.length)}<p class="muted small">Kollox tip wieħed: ikkunsidra xi Reel jew Story.</p>{/if}
  </div>

  {#if people.length}
    <div class="sec">
      <div class="sec-h">Min qed jagħmel xiex</div>
      {#each people as o (o.owner)}
        <div class="mx pp"><span class="truncate" class:muted={!o.owner}>{o.owner || 'Ħadd assenjat'}</span><span class="mono" class:late={o.late}>{o.open} miftuħa{o.late ? ` · ${o.late} tard` : ''}</span></div>
      {/each}
    </div>
  {/if}

  {#if campaign.notes}<div class="sec"><div class="sec-h">Noti</div><p class="small notes">{campaign.notes}</p></div>{/if}
</div>

<style>
  .cp { display: flex; flex-direction: column; gap: 10px; }
  .cp-h { display: flex; align-items: center; gap: 8px; }
  .cp-h h2 { margin: 0; font-size: 17px; flex: 1; min-width: 0; }
  .sw { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; }
  .goal { margin: 0; font-size: 13px; display: flex; gap: 6px; align-items: center; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .acts [aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .stats div { display: flex; flex-direction: column; padding: 6px 8px; border-radius: 8px; background: var(--bg-sunken); }
  .stats b { font-size: 16px; }
  .stats span { font-size: 11px; color: var(--muted); }
  .sec { display: flex; flex-direction: column; gap: 4px; }
  .sec-h { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .wk { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 52px 1fr 40px; gap: 8px; align-items: center; padding: 3px 6px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .wk:hover { background: var(--hover); }
  .wk.past { opacity: .55; }
  .wk.short { background: var(--warn-bg); color: var(--warn-fg); }
  .meter { height: 6px; border-radius: 3px; background: var(--bar); overflow: hidden; }
  .meter span { display: block; height: 100%; border-radius: 3px; }
  .mono { font-family: var(--font-mono); font-size: 11.5px; text-align: right; }
  .wk .mono:first-child { text-align: left; }
  .gap { display: flex; gap: 8px; align-items: baseline; }
  .gap .muted { flex: 1; }
  .ev { all: unset; box-sizing: border-box; display: flex; gap: 8px; align-items: center; padding: 5px 6px; border-radius: 8px; cursor: pointer; font-size: 13px; width: 100%; }
  .ev:hover { background: var(--hover); }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .notes { margin: 0; white-space: pre-wrap; }
  .mx { display: grid; grid-template-columns: minmax(0, 1fr) 90px 56px; gap: 8px; align-items: center; font-size: 12.5px; padding: 1px 6px; }
  .mx.none { color: var(--muted); }
  .mx.pp { grid-template-columns: minmax(0, 1fr) auto; }
  .mx .mono { text-align: right; }
  .late { color: var(--danger-fg); }
  .plats { display: flex; gap: 6px; flex-wrap: wrap; padding: 2px 6px; }
</style>
