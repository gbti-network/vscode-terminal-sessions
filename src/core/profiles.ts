/**
 * Scope arithmetic for saved profiles, with no dependency on `vscode`.
 *
 * This module decides *what* should be written where; `src/profiles/registry.ts`
 * performs the writes. The split exists because every profile-destroying defect
 * this codebase has shipped lived in this logic and none of it needed a running
 * editor to reproduce. A plan is a value, so it can be asserted against.
 *
 * The rule that matters: a plan's write for a scope always carries the list
 * computed *for that scope*. It is not possible to express "write the workspace
 * list to global", which is what destroyed every global profile in 0.3.3.
 */
import { InstanceProfile, isValidProfile } from '../profiles/types';

/** Where a profile is stored, and therefore which projects can see it. */
export type ProfileScope = 'workspace' | 'global';

/** The raw arrays settings hold at each scope, unfiltered. */
export interface ScopeSnapshot {
  workspace: readonly unknown[];
  global: readonly unknown[];
}

/**
 * One settings write.
 *
 * `entries` of `undefined` removes the key rather than leaving an empty array,
 * so an emptied workspace list falls back to the global one instead of shadowing
 * it with nothing.
 */
export interface ScopeWrite {
  scope: ProfileScope;
  entries: unknown[] | undefined;
}

export function profilesIn(entries: readonly unknown[]): InstanceProfile[] {
  return entries.filter(isValidProfile);
}

/**
 * Every profile visible in a window: this project's, plus the global ones.
 *
 * A workspace profile shadows a global one of the same name, which is how
 * settings behave everywhere else in VS Code.
 */
export function resolveProfiles(snapshot: ScopeSnapshot): InstanceProfile[] {
  const workspace = profilesIn(snapshot.workspace);
  const taken = new Set(workspace.map((profile) => profile.name));
  return [
    ...workspace,
    ...profilesIn(snapshot.global).filter((profile) => !taken.has(profile.name)),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

/** Which scope a profile currently lives at, workspace winning. */
export function scopeOf(snapshot: ScopeSnapshot, name: string): ProfileScope | undefined {
  if (profilesIn(snapshot.workspace).some((profile) => profile.name === name)) {
    return 'workspace';
  }
  return profilesIn(snapshot.global).some((profile) => profile.name === name)
    ? 'global'
    : undefined;
}

/**
 * Entries that are not the named profile, keeping ones we cannot parse.
 *
 * Dropping unrecognised entries would let a hand-authored profile with a typo be
 * silently deleted by the next unrelated save. The user's text is theirs; this
 * extension only owns the entries it can identify by name.
 */
function without(entries: readonly unknown[], name: string): unknown[] {
  return entries.filter((entry) => !isValidProfile(entry) || entry.name !== name);
}

/** `undefined` for an empty list, so the settings key is removed rather than emptied. */
function packed(entries: unknown[]): unknown[] | undefined {
  return entries.length ? entries : undefined;
}

function sortEntries(entries: unknown[]): unknown[] {
  // Unparseable entries keep their relative order at the end rather than being
  // interleaved by a name they do not have.
  const known = entries.filter(isValidProfile).sort((a, b) => a.name.localeCompare(b.name));
  const unknown = entries.filter((entry) => !isValidProfile(entry));
  return [...known, ...unknown];
}

export interface SavePlan {
  writes: ScopeWrite[];
  /** Where the profile ends up, after the no-folder fallback is applied. */
  scope: ProfileScope;
}

/**
 * Add or replace a profile, optionally moving it to another scope.
 *
 * `canUseWorkspace` is false in a window with no folder open, where workspace
 * settings cannot be written at all. Routing to global *here* is safe because
 * the global list is then computed for global. Falling back at write time is
 * what was not safe.
 *
 * A move writes the addition first. If the second write fails the profile exists
 * at both scopes, where the workspace copy shadows the global one and the user
 * sees exactly one. The reverse order loses the profile outright.
 */
export function planSave(
  snapshot: ScopeSnapshot,
  profile: InstanceProfile,
  target: ProfileScope | undefined,
  canUseWorkspace: boolean,
  fallbackScope: ProfileScope = 'workspace',
): SavePlan {
  const current = scopeOf(snapshot, profile.name);
  const wanted = target ?? current ?? fallbackScope;
  const scope: ProfileScope = wanted === 'workspace' && !canUseWorkspace ? 'global' : wanted;

  const destination = scope === 'workspace' ? snapshot.workspace : snapshot.global;
  const writes: ScopeWrite[] = [
    { scope, entries: packed(sortEntries([...without(destination, profile.name), profile])) },
  ];

  if (current && current !== scope) {
    const source = current === 'workspace' ? snapshot.workspace : snapshot.global;
    writes.push({ scope: current, entries: packed(without(source, profile.name)) });
  }
  return { writes, scope };
}

/**
 * Remove the profile the user can actually see.
 *
 * Only the resolved scope, never both. Deleting at both would take out a global
 * profile that a same-named workspace profile was merely shadowing, which the
 * confirmation prompt never mentioned and the sidebar never showed.
 */
export function planDelete(snapshot: ScopeSnapshot, name: string): ScopeWrite[] {
  const scope = scopeOf(snapshot, name);
  if (!scope) {
    return [];
  }
  const entries = scope === 'workspace' ? snapshot.workspace : snapshot.global;
  return [{ scope, entries: packed(without(entries, name)) }];
}

export interface MovePlan {
  writes: ScopeWrite[];
  /** Names actually moved into the workspace. */
  moved: string[];
  /** Names left in global because the workspace already has that name. */
  skipped: string[];
}

/**
 * Move named profiles out of global settings and into this workspace.
 *
 * A name already taken in the workspace is reported as skipped and left in
 * global. It used to be filtered out of the workspace write and removed from
 * global anyway, which deleted it while reporting it as moved.
 */
export function planMove(
  snapshot: ScopeSnapshot,
  names: readonly string[],
  canUseWorkspace: boolean,
): MovePlan {
  if (!canUseWorkspace || names.length === 0) {
    return { writes: [], moved: [], skipped: [] };
  }
  const wanted = new Set(names);
  const candidates = profilesIn(snapshot.global).filter((profile) => wanted.has(profile.name));
  const taken = new Set(profilesIn(snapshot.workspace).map((profile) => profile.name));

  const moving = candidates.filter((profile) => !taken.has(profile.name));
  const skipped = candidates.filter((profile) => taken.has(profile.name)).map((p) => p.name);
  if (moving.length === 0) {
    return { writes: [], moved: [], skipped };
  }

  const movedNames = new Set(moving.map((profile) => profile.name));
  return {
    writes: [
      { scope: 'workspace', entries: packed(sortEntries([...snapshot.workspace, ...moving])) },
      {
        scope: 'global',
        entries: packed(
          snapshot.global.filter(
            (entry) => !isValidProfile(entry) || !movedNames.has(entry.name),
          ),
        ),
      },
    ],
    moved: [...movedNames],
    skipped,
  };
}

/**
 * Whether saving under this name would overwrite a different profile.
 *
 * `originalName` is the profile being edited, which is allowed to keep its own
 * name. Anything else means two profiles would collapse into one, and Save is
 * the only destructive action in the editor that never asked.
 */
export function collidesWith(
  snapshot: ScopeSnapshot,
  name: string,
  originalName?: string,
): boolean {
  if (originalName && originalName === name) {
    return false;
  }
  return resolveProfiles(snapshot).some((profile) => profile.name === name);
}
