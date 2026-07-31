import * as vscode from 'vscode';
import { InstanceProfile, isValidProfile } from './types';

const SECTION = 'terminalSessions';
const KEY = 'instanceProfiles';

/**
 * Saved profiles live in **user settings**, not workspace state.
 *
 * Deliberately: they are personal recipes that should follow you between
 * projects, and keeping them in `settings.json` means you can hand-edit,
 * duplicate and diff them instead of being locked into the guided prompts.
 */
export function getProfiles(): InstanceProfile[] {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown[]>(KEY, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isValidProfile);
}

export function findProfile(name: string): InstanceProfile | undefined {
  return getProfiles().find((profile) => profile.name === name);
}

/** Add or replace a profile by name. */
export async function saveProfile(profile: InstanceProfile): Promise<void> {
  const profiles = getProfiles().filter((existing) => existing.name !== profile.name);
  profiles.push(profile);
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  await write(profiles);
}

export async function deleteProfile(name: string): Promise<void> {
  await write(getProfiles().filter((profile) => profile.name !== name));
}

async function write(profiles: InstanceProfile[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update(KEY, profiles, vscode.ConfigurationTarget.Global);
}
