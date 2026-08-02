/**
 * Regression tests for the profile scope arithmetic.
 *
 * Every case here is a defect this extension shipped. The audit that found them
 * could only find them by reading, because there was nothing to run. Each test
 * is named for the finding it pins down.
 *
 * These run against the compiled out/, with no `vscode` in sight: that is the
 * whole point of src/core existing.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  planSave,
  planDelete,
  planMove,
  resolveProfiles,
  scopeOf,
  collidesWith,
} = require('../out/core/profiles.js');

const p = (name, extra = {}) => ({ name, commands: ['echo ' + name], ...extra });
const snap = (workspace = [], global = []) => ({ workspace, global });

/** The list a write would leave at a scope, or undefined if the key is removed. */
const writeFor = (writes, scope) => writes.find((w) => w.scope === scope)?.entries;
const namesAt = (writes, scope) => (writeFor(writes, scope) ?? []).map((e) => e.name);

// ---------------------------------------------------------------- R1

test('R1: a plan never writes one scope\'s list to the other scope', () => {
  const s = snap([p('ws-only')], [p('g1'), p('g2')]);
  const { writes } = planSave(s, p('ws-only'), 'workspace', true);

  // The historical defect: a failed workspace write re-issued the *workspace*
  // array at global, replacing every global profile. A plan cannot express it.
  const global = writes.find((w) => w.scope === 'global');
  assert.equal(global, undefined, 'saving to workspace must not touch global at all');
});

test('R1: routing to global with no folder open computes the global list, not the workspace one', () => {
  const s = snap([p('ws-only')], [p('g1')]);
  const { writes, scope } = planSave(s, p('new'), 'workspace', false);

  assert.equal(scope, 'global');
  assert.deepEqual(namesAt(writes, 'global').sort(), ['g1', 'new']);
  assert.equal(writeFor(writes, 'workspace'), undefined);
});

// ---------------------------------------------------------------- R2 and R6

test('R6: moveToWorkspace skips a name the workspace already has, and does not delete it', () => {
  const s = snap([p('dev')], [p('dev'), p('api')]);
  const { writes, moved, skipped } = planMove(s, ['dev', 'api'], true);

  assert.deepEqual(moved, ['api']);
  assert.deepEqual(skipped, ['dev'], 'the colliding name is reported, not silently dropped');

  // The defect: `dev` was filtered out of the workspace write and removed from
  // global anyway, destroying it while reporting "Moved 2 profiles".
  assert.ok(namesAt(writes, 'global').includes('dev'), 'a skipped profile stays in global');
});

test('R2: the global write removes only the names that actually moved', () => {
  const s = snap([], [p('a'), p('b'), p('c')]);
  const { writes } = planMove(s, ['a'], true);

  assert.deepEqual(namesAt(writes, 'global').sort(), ['b', 'c']);
  assert.deepEqual(namesAt(writes, 'workspace').sort(), ['a']);
});

test('R2: moving nothing produces no writes at all', () => {
  const s = snap([], [p('a')]);
  assert.deepEqual(planMove(s, [], true).writes, []);
  assert.deepEqual(planMove(s, ['a'], false).writes, [], 'no folder open means no move');
});

// ---------------------------------------------------------------- R7

test('R7: deleting a workspace profile leaves the global profile it shadows', () => {
  const s = snap([p('dev')], [p('dev')]);
  const writes = planDelete(s, 'dev');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].scope, 'workspace');
  // The defect: deleteProfile looped both scopes by name, so confirming one
  // modal destroyed a global profile the sidebar never showed.
  assert.equal(writeFor(writes, 'global'), undefined);
});

test('R7: deleting a global-only profile writes global', () => {
  const writes = planDelete(snap([], [p('only')]), 'only');
  assert.equal(writes[0].scope, 'global');
  assert.equal(writes[0].entries, undefined, 'an emptied list removes the key');
});

test('deleting an unknown name writes nothing', () => {
  assert.deepEqual(planDelete(snap([p('a')], []), 'nope'), []);
});

// ---------------------------------------------------------------- R8

test('R8: a scope move adds before it removes', () => {
  const s = snap([], [p('movable')]);
  const { writes } = planSave(s, p('movable'), 'workspace', true);

  assert.equal(writes.length, 2);
  assert.equal(writes[0].scope, 'workspace', 'the addition is written first');
  assert.equal(writes[1].scope, 'global', 'the removal is written second');
  // If the second write fails the profile exists at both scopes and the
  // workspace copy shadows the global one, so the user still sees exactly one.
  // The old order deleted first and lost the profile when the write failed.
});

// ---------------------------------------------------------------- R10

test('R10: entries that fail validation are preserved through an unrelated write', () => {
  const broken = { name: '', commands: [] }; // no name: isValidProfile rejects it
  const typo = { nmae: 'oops', commands: [] };
  const s = snap([broken, typo, p('real')], []);

  const { writes } = planSave(s, p('added'), 'workspace', true);
  const entries = writeFor(writes, 'workspace');

  assert.ok(entries.includes(broken), 'a half-written profile survives');
  assert.ok(entries.includes(typo), 'a typo survives rather than being pruned');
  assert.equal(entries.length, 4);
});

test('R10: unparseable entries survive a delete too', () => {
  const typo = { nmae: 'oops' };
  const writes = planDelete(snap([typo, p('real')], []), 'real');
  assert.deepEqual(writeFor(writes, 'workspace'), [typo]);
});

// ---------------------------------------------------------------- R3

test('R3: saving a new profile onto an existing name is reported as a collision', () => {
  const s = snap([p('web')], [p('api')]);
  assert.equal(collidesWith(s, 'web'), true);
  assert.equal(collidesWith(s, 'api'), true, 'a global name collides too');
  assert.equal(collidesWith(s, 'fresh'), false);
});

test('R3: a profile keeping its own name is not a collision', () => {
  const s = snap([p('web')], []);
  assert.equal(collidesWith(s, 'web', 'web'), false);
  assert.equal(collidesWith(s, 'web', 'other'), true, 'renaming onto a taken name is');
});

// ------------------------------------------------------- resolution invariants

test('workspace shadows global, and the result is sorted', () => {
  const s = snap([p('b', { cwd: '/ws' })], [p('a'), p('b', { cwd: '/global' })]);
  const resolved = resolveProfiles(s);

  assert.deepEqual(resolved.map((x) => x.name), ['a', 'b']);
  assert.equal(resolved[1].cwd, '/ws', 'the workspace copy wins');
});

test('scopeOf reports where the visible profile lives', () => {
  assert.equal(scopeOf(snap([p('x')], [p('x')]), 'x'), 'workspace');
  assert.equal(scopeOf(snap([], [p('x')]), 'x'), 'global');
  assert.equal(scopeOf(snap([], []), 'x'), undefined);
});

test('an existing profile is rewritten where it already lives', () => {
  const s = snap([], [p('g')]);
  const { scope, writes } = planSave(s, p('g', { cwd: '/new' }), undefined, true);

  assert.equal(scope, 'global', 'no target means stay put');
  assert.equal(writes.length, 1);
});
