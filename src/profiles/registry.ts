import * as vscode from 'vscode';
import { InstanceProfile, isValidProfile } from './types';

const SECTION = 'terminalSessions';
const KEY = 'instanceProfiles';
const SCOPE_KEY = 'profileScope';

/** Where a profile is stored, and therefore which projects can see it. */
export type ProfileScope = 'workspace' | 'global';

/**
 * Profiles live in settings, at one of two scopes.
 *
 * Originally they were global only, on the reasoning that a profile is a
 * personal recipe that should follow you between projects. In practice a recipe
 * is usually *about* a project: it names that project's directory and runs that
 * project's commands, so seeing every project's profiles in every window is
 * noise. Workspace is the default now, and global remains for the handful that
 * genuinely are portable.
 *
 * Reading unions the two rather than letting VS Code resolve them. For array
 * settings VS Code does not merge, it *replaces*, so a workspace list would
 * hide the global list entirely, which is not what "workspace plus global"
 * should mean.
 */
export function profileScope(): ProfileScope {
  return vscode.workspace.getConfiguration(SECTION).get<ProfileScope>(SCOPE_KEY) === 'global'
    ? 'global'
    : 'workspace';
}

/** True when there is anywhere to write workspace settings at all. */
export function hasWorkspace(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function readAt(scope: ProfileScope): InstanceProfile[] {
  const values = vscode.workspace.getConfiguration(SECTION).inspect<unknown[]>(KEY);
  const raw =
    scope === 'global'
      ? values?.globalValue
      : (values?.workspaceFolderValue ?? values?.workspaceValue);
  return Array.isArray(raw) ? raw.filter(isValidProfile) : [];
}

export function globalProfiles(): InstanceProfile[] {
  return readAt('global');
}

export function workspaceProfiles(): InstanceProfile[] {
  return readAt('workspace');
}

/**
 * Every profile visible here: this project's, plus the global ones.
 *
 * A workspace profile shadows a global one of the same name, which is how
 * settings behave everywhere else in VS Code.
 */
export function getProfiles(): InstanceProfile[] {
  const workspace = readAt('workspace');
  const taken = new Set(workspace.map((profile) => profile.name));
  return [...workspace, ...readAt('global').filter((profile) => !taken.has(profile.name))].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

export function findProfile(name: string): InstanceProfile | undefined {
  return getProfiles().find((profile) => profile.name === name);
}

/** Which scope a profile currently lives in, if any. */
export function scopeOf(name: string): ProfileScope | undefined {
  if (readAt('workspace').some((profile) => profile.name === name)) {
    return 'workspace';
  }
  return readAt('global').some((profile) => profile.name === name) ? 'global' : undefined;
}

/**
 * Add or replace a profile by name, optionally moving it to another scope.
 *
 * `target` is what the editor's own scope control sends, so changing it there
 * moves the profile. Without one, an existing profile is rewritten where it
 * already lives and a new one follows `terminalSessions.profileScope`. Either
 * way this falls back to global in a window with no folder open, where
 * workspace settings cannot be written at all.
 *
 * A move writes the removal first, so the profile is never briefly present at
 * both scopes, where the workspace copy would shadow the global one.
 */
export async function saveProfile(
  profile: InstanceProfile,
  target?: ProfileScope,
): Promise<void> {
  const current = scopeOf(profile.name);
  const wanted = target ?? current ?? profileScope();
  const scope: ProfileScope = wanted === 'workspace' && !hasWorkspace() ? 'global' : wanted;

  if (current && current !== scope) {
    await writeAt(
      current,
      readAt(current).filter((other) => other.name !== profile.name),
    );
  }
  await writeAt(scope, [
    ...readAt(scope).filter((other) => other.name !== profile.name),
    profile,
  ]);
}

/** Remove a profile from wherever it lives, both scopes included. */
export async function deleteProfile(name: string): Promise<void> {
  for (const scope of ['workspace', 'global'] as const) {
    const before = readAt(scope);
    const after = before.filter((profile) => profile.name !== name);
    if (after.length !== before.length) {
      await writeAt(scope, after);
    }
  }
}

/** Move named profiles out of global settings and into this workspace. */
export async function moveToWorkspace(names: string[]): Promise<number> {
  if (!hasWorkspace() || names.length === 0) {
    return 0;
  }
  const wanted = new Set(names);
  const moving = readAt('global').filter((profile) => wanted.has(profile.name));
  if (moving.length === 0) {
    return 0;
  }
  const existing = readAt('workspace');
  const taken = new Set(existing.map((profile) => profile.name));
  await writeAt('workspace', [
    ...existing,
    ...moving.filter((profile) => !taken.has(profile.name)),
  ]);
  await writeAt(
    'global',
    readAt('global').filter((profile) => !wanted.has(profile.name)),
  );
  return moving.length;
}

async function writeAt(scope: ProfileScope, profiles: InstanceProfile[]): Promise<void> {
  const sorted = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
  await vscode.workspace.getConfiguration(SECTION).update(
    KEY,
    // `undefined` removes the key rather than leaving an empty array behind, so
    // an emptied workspace list falls back to the global one instead of
    // shadowing it with nothing.
    sorted.length ? sorted : undefined,
    scope === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace,
  );
}
