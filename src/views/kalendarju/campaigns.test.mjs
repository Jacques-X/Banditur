import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_NAMES, isOpen, campaignsOn, defaultCampaign, slotTimes, movedSlot, weeks, perWeek, campaignWeeks, emptyDays, runs, bar, dueOf, comingDue, byOwner, mix, perPlatform } from './campaigns.js';
import { cleanCampaign, cleanSlot, cleanEvent } from '../../../backend/api/_lib/event-rules.js';

const festa = { id: 'c1', name: 'Festa', from: '2026-06-03', to: '2026-06-21', target: 7 };
const banda = { id: 'c2', name: 'Banda', from: '2026-06-15', to: '2026-06-30', target: 0 };

test('which campaigns cover a day, and the default for something new', () => {
  assert.deepEqual(campaignsOn([banda, festa], '2026-06-16').map((c) => c.id), ['c1', 'c2']);
  assert.equal(defaultCampaign([festa, banda], '2026-06-10'), 'c1');
  assert.equal(defaultCampaign([festa, banda], '2026-06-16'), '');
  assert.equal(defaultCampaign([festa, banda], '2026-07-01'), '');
});

test('slots as calendar times and moves', () => {
  assert.deepEqual(slotTimes({ day: '2026-06-10', time: '' }), { start: '2026-06-10', end: '2026-06-11', allDay: true });
  assert.deepEqual(slotTimes({ day: '2026-06-10', time: '18:30' }), { start: '2026-06-10T18:30', end: '2026-06-10T19:00', allDay: false });
  assert.deepEqual(movedSlot({ day: '2026-06-10', time: '' }, 2, 45), { day: '2026-06-12' });
  assert.deepEqual(movedSlot({ day: '2026-06-10', time: '23:30' }, 0, 60), { day: '2026-06-11', time: '00:30' });
});

test('weeks and counts per week', () => {
  const w = weeks('2026-06-03', '2026-06-22');
  assert.deepEqual(w, ['2026-06-01', '2026-06-08', '2026-06-15']);
  assert.deepEqual(perWeek(w, ['2026-06-01', '2026-06-07', '2026-06-08', '2026-07-01']), [2, 1, 0]);
});

test('campaign weeks scale the target to the days covered', () => {
  const days = ['2026-06-03', '2026-06-04', '2026-06-05', '2026-06-09', '2026-06-20', '2026-06-25'];
  const r = campaignWeeks(festa, days);
  assert.deepEqual(r.map((w) => [w.week, w.days, w.count, w.need, w.short]), [
    ['2026-06-01', 5, 3, 5, true],
    ['2026-06-08', 7, 1, 7, true],
    ['2026-06-15', 7, 1, 7, true],
  ]);
  assert.ok(campaignWeeks(banda, days).every((w) => !w.short && w.need === 0));
});

test('empty days ahead and runs of them', () => {
  const c = { from: '2026-06-01', to: '2026-06-07' };
  const e = emptyDays(c, ['2026-06-04', '2026-06-06'], '2026-06-03');
  assert.deepEqual(e, ['2026-06-03', '2026-06-05', '2026-06-07']);
  assert.deepEqual(emptyDays(c, [], '2026-05-01').length, 7);
  assert.deepEqual(emptyDays(c, [], '2026-06-08'), []);
  assert.deepEqual(runs(['2026-06-01', '2026-06-02', '2026-06-04']), [['2026-06-01', '2026-06-02'], ['2026-06-04', '2026-06-04']]);
});

test('timeline bars are clipped to the range', () => {
  assert.deepEqual(bar(festa, '2026-06-01', '2026-07-01'), { left: 2, width: 19, clippedStart: false, clippedEnd: false });
  assert.deepEqual(bar(festa, '2026-06-10', '2026-06-15'), { left: 0, width: 5, clippedStart: true, clippedEnd: true });
  assert.equal(bar(festa, '2026-07-01', '2026-08-01'), null);
});

test('campaign and slot validation', () => {
  assert.deepEqual(cleanCampaign({ name: ' Festa ', from: '2026-06-03', to: '2026-06-21', target: '5', color: 'red' }).campaign,
    { name: 'Festa', color: '#3355D1', from: '2026-06-03', to: '2026-06-21', goal: '', target: 5, notes: '' });
  assert.ok(cleanCampaign({ name: 'X', from: '2026-06-03', to: '2026-06-02' }).error);
  assert.ok(cleanCampaign({ name: 'X', from: '2026-06-03', to: '2026-06-03', target: 2.5 }).error);
  assert.ok(cleanCampaign({ name: '', from: '2026-06-03', to: '2026-06-03' }).error);
  const id = '11111111-2222-4333-8444-555555555555';
  const s = cleanSlot({ title: 'Teaser', day: '2026-06-10', time: '18:30', platforms: ['ig', 'fb'], campaign: id }).slot;
  assert.deepEqual(s, { title: 'Teaser', day: '2026-06-10', time: '18:30', platforms: ['fb', 'ig'], status: 'idea', campaign: id, event: '', notes: '', post_id: '', owner: '', due: '', category: '' });
  assert.deepEqual(cleanSlot({ title: 'X', day: '2026-06-10', owner: ' Marija ', due: '2026-06-08', category: ' Reel ' }).slot.owner, 'Marija');
  assert.ok(cleanSlot({ title: 'X', day: '2026-06-10', due: '8 June' }).error);
  assert.ok(cleanSlot({ title: 'X', day: '2026-06-10', time: '25:00' }).error);
  assert.ok(cleanSlot({ title: 'X', day: '2026-06-10', platforms: ['myspace'] }).error);
  assert.ok(cleanSlot({ title: 'X', day: '2026-06-10', status: 'maybe' }).error);
  assert.ok(cleanSlot({ title: 'X', day: '2026-06-10', campaign: 'c1' }).error);
  const ev = { title: 'Festa', start: '2026-06-15T19:00', end: '2026-06-15T19:30' };
  assert.equal(cleanEvent(ev).event.campaign, '');
  assert.equal(cleanEvent({ ...ev, campaign: id }).event.campaign, id);
  assert.ok(cleanEvent({ ...ev, campaign: 'nope' }).error);
});

test('coming due: not ready, by the ready-by day, late ones flagged', () => {
  const s = (o) => ({ id: o.title, status: 'idea', day: '2026-12-10', due: '', owner: '', time: '', ...o });
  const slots = [
    s({ title: 'late', due: '2026-12-01' }),
    s({ title: 'soon', day: '2026-12-04' }),
    s({ title: 'ready', day: '2026-12-03', status: 'ready' }),
    s({ title: 'done', day: '2026-12-03', status: 'done' }),
    s({ title: 'far', day: '2026-12-20' }),
    s({ title: 'due-soon', day: '2026-12-20', due: '2026-12-05' }),
  ];
  assert.equal(dueOf(slots[1]), '2026-12-04');
  const r = comingDue(slots, '2026-12-02', 3);
  assert.deepEqual(r.map((x) => [x.slot.title, x.late]), [['late', true], ['soon', false], ['due-soon', false]]);
});

test('open planned posts per owner', () => {
  const slots = [
    { owner: 'Marija', status: 'idea', day: '2026-12-01', due: '' },
    { owner: 'Marija', status: 'ready', day: '2026-12-01', due: '' },
    { owner: 'Ġorġ', status: 'draft', day: '2026-12-09', due: '' },
    { owner: '', status: 'idea', day: '2026-12-09', due: '' },
    { owner: 'Ġorġ', status: 'done', day: '2026-12-01', due: '' },
  ];
  assert.deepEqual(byOwner(slots, '2026-12-05'), [
    { owner: 'Marija', open: 2, late: 1 },
    { owner: 'Ġorġ', open: 1, late: 0 },
    { owner: '', open: 1, late: 0 },
  ]);
});

test('content mix and platforms', () => {
  const items = [{ category: 'Reel', platforms: ['fb', 'ig'] }, { category: 'reel ', platforms: ['ig'] }, { category: '', platforms: [] }, { category: 'Poster', platforms: ['fb'] }];
  assert.deepEqual(mix(items), [{ name: 'Reel', count: 2 }, { name: 'Poster', count: 1 }, { name: '', count: 1 }]);
  assert.deepEqual(perPlatform(items), { fb: 2, ig: 2 });
});

test('Ippubblikat is a status you set by hand: closed for work, but still a planned post in counts and gaps', () => {
  assert.equal(STATUS_NAMES.done, 'Ippubblikat');
  assert.equal(isOpen({ status: 'done' }), false);
  assert.equal(isOpen({ status: 'ready' }), true);
  const slots = [{ day: '2026-06-04', status: 'done' }, { day: '2026-06-05', status: 'idea' }];
  const days = slots.map((x) => x.day);
  assert.equal(campaignWeeks(festa, days)[0].count, 2);
  assert.deepEqual(emptyDays({ from: '2026-06-03', to: '2026-06-06' }, days, '2026-06-03'), ['2026-06-03', '2026-06-06']);
});
