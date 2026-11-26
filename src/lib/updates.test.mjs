import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyReason, needsAttention, updateState, stateLines, buttonState, resultNotice, commitLine, nextStep } from './updates.js';
import { UPD } from '../strings.js';

const ok = { configured: true, behind: 0, ahead: 0, dirty: false, pending: false, building: false, commits: [] };

test('busyReason: a running tool lane or Arkivju upload blocks the update', () => {
  assert.equal(busyReason({ photos: false, youtube: false }, [{ state: 'done' }]), '');
  assert.equal(busyReason({ photos: false, youtube: true }, []), UPD.busy_work);
  assert.equal(busyReason({}, [{ state: 'queued' }, { state: 'running' }]), UPD.busy_work);
  assert.equal(busyReason(), '');
});

test('updateState picks the most important state', () => {
  assert.equal(updateState(null), 'unconfigured');
  assert.equal(updateState({ configured: false }), 'unconfigured');
  assert.equal(updateState(ok, { running: true }), 'running');
  assert.equal(updateState({ ...ok, building: true }), 'building');
  assert.equal(updateState({ ...ok, error: 'x', behind: 2 }), 'error');
  assert.equal(updateState({ ...ok, dirty: true, behind: 2 }), 'dirty');
  assert.equal(updateState({ ...ok, ahead: 1, behind: 2 }), 'diverged');
  assert.equal(updateState({ ...ok, behind: 2, pending: true }), 'behind');
  assert.equal(updateState({ ...ok, pending: true }), 'pending');
  assert.equal(updateState(ok), 'current');
});

test('needsAttention: commits waiting or built-but-not-installed, never while an update runs or unconfigured', () => {
  assert.equal(needsAttention(null), false);
  assert.equal(needsAttention({ configured: false, behind: 3 }), false);
  assert.equal(needsAttention(ok), false);
  assert.equal(needsAttention({ ...ok, behind: 1 }), true);
  assert.equal(needsAttention({ ...ok, pending: true }), true);
  assert.equal(needsAttention({ ...ok, behind: 1, building: true }), false);
});

test('stateLines adds the offline note when GitHub could not be reached', () => {
  assert.deepEqual(stateLines({ ...ok, behind: 1 }), [UPD.changes(1)]);
  assert.deepEqual(stateLines({ ...ok, behind: 3, fetchError: 'x' }), [UPD.changes(3), UPD.offline]);
  assert.deepEqual(stateLines({ configured: false, fetchError: 'x' }), [UPD.not_set_up]);
  assert.match(UPD.changes(1), /waħda/);
});

test('buttonState: disabled with a reason when something blocks it, enabled otherwise', () => {
  assert.deepEqual(buttonState(ok), { label: UPD.update, disabled: false, reason: '' });
  assert.equal(buttonState({ configured: false }).disabled, true);
  assert.equal(buttonState(ok, { checking: true }).disabled, true);
  assert.deepEqual(buttonState(ok, { running: true }), { label: UPD.updating, disabled: true, reason: '' });
  assert.deepEqual(buttonState({ ...ok, behind: 1 }, { busy: UPD.busy_work }), { label: UPD.update, disabled: true, reason: UPD.busy_work });
  assert.equal(buttonState({ ...ok, dirty: true, behind: 1 }).reason, UPD.dirty);
  assert.equal(buttonState({ ...ok, building: true }).reason, UPD.busy_update);
});

test('resultNotice: ok with the new head, or the error with its log tail', () => {
  assert.equal(resultNotice(null), null);
  assert.deepEqual(resultNotice({ ok: true, head: 'abc1234' }), { type: 'ok', msg: UPD.done_ok('abc1234'), detail: '' });
  assert.match(resultNotice({ ok: true, head: 'abc1234' }, { ui: true }).msg, /qed tinġarr/);
  const bad = resultNotice({ ok: false, error: 'boom', logTail: 'l1\nl2' });
  assert.equal(bad.type, 'error');
  assert.match(bad.msg, /boom/);
  assert.equal(bad.detail, 'l1\nl2');
});

test('commitLine and nextStep', () => {
  assert.equal(commitLine({ hash: 'a1b2c3d', subject: 'Fix it' }), 'a1b2c3d  Fix it');
  assert.equal(nextStep({ work: false, core: false }), 'none');
  assert.equal(nextStep(null), 'none');
  assert.equal(nextStep({ work: true, core: true, ui: true }), 'restart');
  assert.equal(nextStep({ work: true, core: false, ui: true }), 'background');
});
