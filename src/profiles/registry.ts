import * as vscode from 'vscode';
import { InstanceProfile } from './types';
import {
  collidesWith,
  MovePlan,
  planDelete,
  planMove,
  planSave,
  ProfileScope,
  profilesIn,
  resolveProfiles,
  ScopeSnapshot,
  ScopeWrite,
  scopeOf as scopeOfSnapshot,
} from '../core/profiles';

const SECTION = 'terminalSessions';
const KEY = 'instanceProfiles';
const SCOPE_KEY = 'profileScope';

export type { ProfileScope };

/**
 * Profiles live in settings, at one of two scopes.
 *
 * Originally they were global only, on the reasoning that a profile is a
 * personal setup that should follow you between projects. In practice a setup
 * is usually *about* a project: it names that project's directory and runs that
 * project's commands, so seeing every project's profiles in every window is
 * noise. Workspace is the default now, and global remains for the handful that
 * genuinely are portable.
 *
 * This module is the settings adapter and nothing else. Every decision about
 * what belongs where is made in `src/core/profiles.ts`, against plain arrays,
 * because that is where the defects were and reading alone did not catch them.
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

/**
 * Both scopes as settings actually hold them, unfiltered.
 *
 * Unfiltered on purpose: an entry this version cannot parse is still the user's
 * text, and every write has to carry it through rather than prune it.
 *
 * Read through `inspect` rather than `get`, because for array settings VS Code
 * replaces rather than merges across scopes, so `get` would hide the global list
 * entirely whenever a workspace list exists.
 */
function snapshot(): ScopeSnapshot {
  const values = vscode.workspace.getConfiguration(SECTION).inspect<unknown[]>(KEY);
  return {
    workspace: values?.workspaceFolderValue ?? values?.workspaceValue ?? [],
    global: values?.globalValue ?? [],
  };
}

export function globalProfiles(): InstanceProfile[] {
  return profilesIn(snapshot().global);
}

export function workspaceProfiles(): InstanceProfile[] {
  return profilesIn(snapshot().workspace);
}

/** Every profile visible here: this project's, plus the global ones. */
export function getProfiles(): InstanceProfile[] {
  return resolveProfiles(snapshot());
}

export function findProfile(name: string): InstanceProfile | undefined {
  return getProfiles().find((profile) => profile.name === name);
}

/** Which scope a profile currently lives in, if any. */
export function scopeOf(name: string): ProfileScope | undefined {
  return scopeOfSnapshot(snapshot(), name);
}

/** Whether saving under this name would collapse two profiles into one. */
export function wouldOverwrite(name: string, originalName?: string): boolean {
  return collidesWith(snapshot(), name, originalName);
}

function target(scope: ProfileScope): vscode.ConfigurationTarget {
  return scope === 'global'
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;
}

/**
 * Perform a plan's writes in order, stopping at the first failure.
 *
 * There is deliberately no cross-scope retry here. A previous version caught a
 * failed workspace write and re-issued the *same array* at global scope, which
 * replaced every global profile in every project with this project's list while
 * reporting that the profile "was saved globally instead". Choosing a scope is a
 * planning decision made before any write; a write that fails, fails, and the
 * caller says so.
 */
async function applyWrites(writes: readonly ScopeWrite[]): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  for (const write of writes) {
    await config.update(KEY, write.entries, target(write.scope));
  }
}

/**
 * Add or replace a profile, optionally moving it to another scope.
 *
 * `scope` is what the editor's own control sends, so changing it there moves the
 * profile. Without one, an existing profile is rewritten where it already lives
 * and a new one follows `terminalSessions.profileScope`.
 *
 * Rejects rather than swallowing. A silent failure is what 0.3.3 set out to fix,
 * and the fix is to report it, not to write somewhere else.
 */
export async function saveProfile(
  profile: InstanceProfile,
  scope?: ProfileScope,
): Promise<ProfileScope> {
  const plan = planSave(snapshot(), profile, scope, hasWorkspace(), profileScope());
  await applyWrites(plan.writes);
  return plan.scope;
}

/** Remove the profile the user can see, at the scope it actually lives at. */
export async function deleteProfile(name: string): Promise<void> {
  await applyWrites(planDelete(snapshot(), name));
}

/**
 * Move named profiles out of global settings and into this workspace.
 *
 * Returns what happened rather than a count, because a name the workspace
 * already uses is skipped rather than moved, and reporting it as moved is how a
 * profile used to disappear while the toast said it had been migrated.
 */
export async function moveToWorkspace(names: string[]): Promise<Omit<MovePlan, 'writes'>> {
  const plan = planMove(snapshot(), names, hasWorkspace());
  await applyWrites(plan.writes);
  return { moved: plan.moved, skipped: plan.skipped };
}
