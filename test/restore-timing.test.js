/**
 * Regression tests for when session restore may begin (R17).
 *
 * The defect: a single fixed delay guessed how long VS Code would take to revive
 * its own terminals, and a guess that came in short duplicated every tracked
 * profile with nothing to reconcile it afterwards.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_CAP_MS,
  DEFAULT_QUIET_MS,
  policyFor,
  shouldKeepWaiting,
} = require('../out/core/restore-timing.js');

const policy = policyFor(3000);

test('the configured delay is a floor: never start before it', () => {
  assert.equal(shouldKeepWaiting(policy, 0, undefined), true);
  assert.equal(shouldKeepWaiting(policy, 2999, undefined), true, 'quiet does not beat the floor');
  assert.equal(shouldKeepWaiting(policy, 2999, 9999), true);
});

test('R17: past the floor, a host still opening terminals keeps us waiting', () => {
  // The old behaviour started here regardless and raced the revival it was
  // meant to wait for, producing one duplicate tab per tracked profile.
  assert.equal(shouldKeepWaiting(policy, 3000, 10), true);
  assert.equal(shouldKeepWaiting(policy, 8000, 200), true);
});

test('past the floor and quiet for long enough, start', () => {
  assert.equal(shouldKeepWaiting(policy, 3000, DEFAULT_QUIET_MS), false);
  assert.equal(shouldKeepWaiting(policy, 5000, 4000), false);
});

test('no terminal has appeared at all, which is as quiet as it gets', () => {
  assert.equal(shouldKeepWaiting(policy, 3000, undefined), false);
});

test('the cap wins, so a host that never settles still restores', () => {
  assert.equal(shouldKeepWaiting(policy, DEFAULT_CAP_MS, 1), false);
  assert.equal(shouldKeepWaiting(policy, DEFAULT_CAP_MS + 5000, 1), false);
});

test('a delay of zero disables the floor without breaking the quiet rule', () => {
  const eager = policyFor(0);
  assert.equal(eager.floorMs, 0);
  assert.equal(shouldKeepWaiting(eager, 0, 10), true, 'still waits for quiet');
  assert.equal(shouldKeepWaiting(eager, 0, undefined), false);
});

test('a nonsense delay is treated as no floor rather than trusted', () => {
  for (const bad of [NaN, -1, Infinity]) {
    assert.equal(policyFor(bad).floorMs, 0, `${bad} is not a delay`);
  }
});

test('a floor beyond the cap raises the cap, so the user setting is never ignored', () => {
  const slow = policyFor(60_000);
  assert.ok(slow.capMs >= slow.floorMs);
  assert.equal(shouldKeepWaiting(slow, 30_000, undefined), true, 'still inside the floor');
});
