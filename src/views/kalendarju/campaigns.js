// Campaign planning rules for Kalendarju: which campaigns cover a day, planned-post slots as
// calendar items, posts per week against a campaign's target, and the empty days still ahead.
// Pure (date strings only, like model.js); tested in campaigns.test.mjs.
//
// A campaign covers the days from..to (inclusive). What counts as "something on a day" is
// passed in as a list of day strings: the days of the planned posts (any status).
import { addDays, daysBetween, mondayOf, shiftWall } from './model.js';

export const STATUS_NAMES = { idea: 'Idea', draft: 'Abbozz', ready: 'Lest', done: 'Ippubblikat' };
/** Slots that still need work (a done slot, Ippubblikat, was marked as published by hand). */
export const isOpen = (slot) => slot.status !== 'done';

export const covers = (c, day) => c.from <= day && day <= c.to;
/** Campaigns covering `day`, earliest start first. */
export const campaignsOn = (campaigns, day) => campaigns.filter((c) => covers(c, day)).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
/** The one campaign to pre-select for something new on `day`: only when exactly one covers it. */
export function defaultCampaign(campaigns, day) {
  const on = campaignsOn(campaigns, day);
  return on.length === 1 ? on[0].id : '';
}

/** A slot as a calendar item's times: a timed slot is a 30-minute block, otherwise all day. */
export function slotTimes(slot) {
  if (!slot.time) return { start: slot.day, end: addDays(slot.day, 1), allDay: true };
  const start = `${slot.day}T${slot.time}`;
  return { start, end: shiftWall(start, 30), allDay: false };
}
/** A slot moved by whole days and minutes (minutes only move a timed slot, and never past midnight into another day than dDays says). */
export function movedSlot(slot, dDays, dMinutes = 0) {
  if (!slot.time) return { day: addDays(slot.day, dDays) };
  const w = shiftWall(`${slot.day}T${slot.time}`, dDays * 1440 + dMinutes);
  return { day: w.slice(0, 10), time: w.slice(11, 16) };
}

/** Mondays of the weeks touching [from, to) (to exclusive). */
export function weeks(from, to) {
  const out = [];
  for (let d = mondayOf(from); d < to; d = addDays(d, 7)) out.push(d);
  return out;
}

/** How many entries of `days` fall in each week (Mondays from weeks()). */
export function perWeek(mondays, days) {
  const n = new Map(mondays.map((m) => [m, 0]));
  for (const d of days) {
    const m = mondayOf(d);
    if (n.has(m)) n.set(m, n.get(m) + 1);
  }
  return mondays.map((m) => n.get(m));
}

/**
 * A campaign's weeks with what is planned in them:
 * [{ week, days, count, need, short }] where `days` is how many of the week's days the campaign
 * covers, `need` the target scaled to those days (rounded up), and `short` whether count < need.
 * `days` (the argument) is every dated entry; only those inside the campaign count.
 */
export function campaignWeeks(c, days) {
  const inside = days.filter((d) => covers(c, d));
  const mondays = weeks(c.from, addDays(c.to, 1));
  const counts = perWeek(mondays, inside);
  return mondays.map((week, i) => {
    const first = week < c.from ? c.from : week;
    const lastOfWeek = addDays(week, 6);
    const last = lastOfWeek > c.to ? c.to : lastOfWeek;
    const span = daysBetween(first, last) + 1;
    const need = c.target ? Math.ceil((c.target * span) / 7) : 0;
    return { week, days: span, count: counts[i], need, short: counts[i] < need };
  });
}

/** Days of the campaign from `since` on with nothing planned or posted. */
export function emptyDays(c, days, since) {
  const busy = new Set(days);
  const out = [];
  for (let d = c.from < since ? since : c.from; d <= c.to; d = addDays(d, 1)) if (!busy.has(d)) out.push(d);
  return out;
}

/** Runs of consecutive days ([first, last] pairs) from a sorted list of days. */
export function runs(list) {
  const out = [];
  for (const d of list) {
    const r = out.at(-1);
    if (r && addDays(r[1], 1) === d) r[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/** Where a campaign's bar sits on a timeline of [from, to): { left, width } in days, clipped; null when outside. */
export function bar(c, from, to) {
  const a = c.from < from ? from : c.from;
  const lastDay = addDays(to, -1);
  const b = c.to > lastDay ? lastDay : c.to;
  if (b < a) return null;
  return { left: daysBetween(from, a), width: daysBetween(a, b) + 1, clippedStart: c.from < from, clippedEnd: c.to > lastDay };
}

// ── Who and by when ─────────────────────────────────────────────────────────
/** The day a planned post must be ready by: its own `due`, else its day. */
export const dueOf = (slot) => slot.due || slot.day;
/**
 * Open planned posts not yet Lest whose ready-by day is within `days` from `today` (or past):
 * [{ slot, due, late }] soonest first. Home shows these; Lest and Ippubblikat ones are done with.
 */
export function comingDue(slots, today, days = 3) {
  const until = addDays(today, days);
  return slots
    .filter((s) => isOpen(s) && s.status !== 'ready' && dueOf(s) <= until)
    .map((s) => ({ slot: s, due: dueOf(s), late: dueOf(s) < today }))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.slot.time || '') < (b.slot.time || '') ? -1 : 1));
}
/** Open planned posts per owner: [{ owner, open, late }] ('' = nobody yet), most open first. */
export function byOwner(slots, today) {
  const m = new Map();
  for (const s of slots.filter(isOpen)) {
    const k = s.owner || '';
    const r = m.get(k) || { owner: k, open: 0, late: 0 };
    r.open++;
    if (s.status !== 'ready' && dueOf(s) < today) r.late++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.open - a.open || (a.owner === '' ? 1 : b.owner === '' ? -1 : a.owner.localeCompare(b.owner)));
}

// ── Content mix ─────────────────────────────────────────────────────────────
/** Suggested types for planned posts (free text: anything else is fine too). */
export const CONTENT_TYPES = ['Poster', 'Reel', 'Story', 'Ritratti', 'Video', 'Avviż', 'Countdown', 'Sponsor', 'Grazzi', 'Wara l-kwinti'];
/**
 * Types of a set of planned posts: [{ name, count }], most first, the same type in any
 * letter case counted once (shown as first written); untyped ones last as name ''.
 * items: { category } objects (planned posts).
 */
export function mix(items) {
  const m = new Map();
  for (const it of items) {
    const name = String(it.category || '').trim();
    const k = name.toLowerCase();
    const r = m.get(k) || { name, count: 0 };
    r.count++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => (a.name === '') - (b.name === '') || b.count - a.count || a.name.localeCompare(b.name));
}
/** How many of the items go to each platform: { fb: n, ig: n, … } (an item can count for several). */
export function perPlatform(items) {
  const out = {};
  for (const it of items) for (const p of it.platforms || []) out[p] = (out[p] || 0) + 1;
  return out;
}
