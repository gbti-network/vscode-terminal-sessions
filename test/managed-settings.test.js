/**
 * Regression tests for the snapshot of settings the column layout overrides.
 *
 * The defect these pin down (R4) shipped because the failure is one JSON round
 * trip away from the code that looks correct, and nothing here ever ran.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  captureSnapshot,
  emptySnapshot,
  readSnapshot,
  restoreWrites,
  wasCaptured,
} = require('../out/core/managed-settings.js');

const KEYS = [
  'terminal.integrated.defaultLocation',
  'workbench.panel.defaultLocation',
  'terminal.integrated.persistentSessionReviveProcess',
  'workbench.panel.opensMaximized',
];

/** What a Memento does to a value: it crosses the RPC boundary as JSON. */
const roundTrip = (value) => JSON.parse(JSON.stringify(value));

const reader = (map) => (key) => map[key];

test('R4: a snapshot of unset keys survives a JSON round trip', () => {
  const snapshot = captureSnapshot(undefined, KEYS, reader({}));
  const revived = roundTrip(snapshot);

  // The defect: values were stored as {key: undefined}, which JSON drops, so the
  // snapshot came back {} and the next capture recorded our own overrides.
  assert.deepEqual(revived.keys, KEYS, 'every captured key survives');
  for (const key of KEYS) {
    assert.equal(wasCaptured(revived, key), true);
  }
});

test('R4: after a round trip, capture does not re-record the extension overrides', () => {
  const first = roundTrip(captureSnapshot(undefined, KEYS, reader({})));

  // Second activation: the settings now hold this extension's own values.
  const ours = {
    'terminal.integrated.defaultLocation': 'view',
    'workbench.panel.defaultLocation': 'right',
    'terminal.integrated.persistentSessionReviveProcess': 'onExitAndWindowClose',
    'workbench.panel.opensMaximized': 'never',
  };
  const second = captureSnapshot(first, KEYS, reader(ours));

  assert.deepEqual(second.values, {}, 'nothing the extension wrote is captured as the user\'s');
});

test('R4: restoring an unset key removes it rather than pinning our default', () => {
  const snapshot = roundTrip(captureSnapshot(undefined, KEYS, reader({})));
  const writes = restoreWrites(snapshot);

  assert.equal(writes.length, 4);
  for (const write of writes) {
    assert.equal(write.value, undefined, `${write.key} is removed, not set`);
  }
});

test('a value the user did set is captured and restored exactly', () => {
  const mine = { 'workbench.panel.defaultLocation': 'bottom' };
  const snapshot = roundTrip(captureSnapshot(undefined, KEYS, reader(mine)));

  assert.equal(snapshot.values['workbench.panel.defaultLocation'], 'bottom');
  const write = restoreWrites(snapshot).find((w) => w.key === 'workbench.panel.defaultLocation');
  assert.equal(write.value, 'bottom');
});

test('existing entries win, so a re-capture never overwrites the original', () => {
  const first = captureSnapshot(undefined, KEYS, reader({ 'workbench.panel.opensMaximized': 'preserve' }));
  const second = captureSnapshot(first, KEYS, reader({ 'workbench.panel.opensMaximized': 'never' }));

  assert.equal(second.values['workbench.panel.opensMaximized'], 'preserve');
});

test('a key added by a later version is backfilled without disturbing the rest', () => {
  const first = captureSnapshot(undefined, KEYS.slice(0, 2), reader({ 'terminal.integrated.defaultLocation': 'editor' }));
  const second = captureSnapshot(first, KEYS, reader({ 'workbench.panel.opensMaximized': 'preserve' }));

  assert.deepEqual(second.keys, KEYS);
  assert.equal(second.values['terminal.integrated.defaultLocation'], 'editor', 'the original survives');
  assert.equal(second.values['workbench.panel.opensMaximized'], 'preserve', 'the new key is captured');
});

test('a legacy flat snapshot is read as captured, so Disable still removes unset keys', () => {
  const legacy = { 'workbench.panel.defaultLocation': 'bottom' };
  const snapshot = readSnapshot(legacy, KEYS);

  assert.deepEqual(snapshot.keys, KEYS);
  assert.equal(snapshot.values['workbench.panel.defaultLocation'], 'bottom');
  const writes = restoreWrites(snapshot);
  assert.equal(writes.find((w) => w.key === 'workbench.panel.opensMaximized').value, undefined);
});

test('readSnapshot passes the current shape through and rejects junk', () => {
  const current = emptySnapshot();
  assert.deepEqual(readSnapshot(current, KEYS), current);
  assert.equal(readSnapshot(undefined, KEYS), undefined);
  assert.equal(readSnapshot('nonsense', KEYS), undefined);
});
