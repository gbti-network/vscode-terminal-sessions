import * as vscode from 'vscode';
import { InstanceProfile, describeProfile } from './types';
import { getProfiles } from './registry';

/**
 * Turn a terminal into the starting point for a new profile.
 *
 * Only the name and directory are readable — `creationOptions` comes back empty
 * for terminals VS Code launched from a profile, and shell integration cannot
 * see into a nested shell. So this seeds a draft; the rest is filled in by hand
 * in the profile manager.
 */
export function draftFromTerminal(
  terminal: vscode.Terminal | undefined,
  distros: string[],
): Partial<InstanceProfile> {
  const cwd = terminal?.shellIntegration?.cwd?.fsPath;
  const distro = preferredDistro(distros);

  return {
    name: terminal?.name ?? '',
    distro,
    cwd: cwd ? toLinuxPath(cwd, Boolean(distro)) : undefined,
    commands: [],
  };
}

/**
 * VS Code reports a Windows path even for WSL shells, so convert for the Linux
 * side: `D:\a\b` becomes `/mnt/d/a/b`.
 */
function toLinuxPath(path: string, isWsl: boolean): string {
  if (!isWsl) {
    return path;
  }
  const match = path.match(/^([a-zA-Z]):[\\/](.*)$/);
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}` : path;
}

/**
 * Distros that exist to back other tooling rather than to be worked in.
 *
 * Docker Desktop registers these, and `docker-desktop` is often the *default*
 * distro — so a bare `wsl` lands somewhere with none of your tools installed.
 * Skipping them makes the preselected shell the one you actually meant.
 */
const INFRASTRUCTURE_DISTROS = /^docker-desktop(-data)?$/i;

export function preferredDistro(distros: string[]): string | undefined {
  return distros.find((d) => !INFRASTRUCTURE_DISTROS.test(d)) ?? distros[0];
}

/**
 * A sensible starting point for a brand-new profile.
 *
 * Everything here is a guess the user can override, but guessing well matters:
 * the alternative is an empty form that has to be filled in from scratch every
 * time, when the answer is nearly always "this workspace, in my usual distro".
 */
export function defaultDraft(
  distros: string[],
  existingNames: string[],
  workspacePath?: string,
): Partial<InstanceProfile> {
  const distro = preferredDistro(distros);
  const base = workspacePath ? basename(workspacePath) : 'Session';

  let name = base;
  for (let i = 2; existingNames.includes(name); i++) {
    name = `${base} ${i}`;
  }

  return {
    name,
    distro,
    cwd: workspacePath ? toLinuxPath(workspacePath, Boolean(distro)) : undefined,
    commands: [],
  };
}

function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Pick a saved profile. */
export async function pickProfile(
  placeHolder = 'Open which saved profile?',
): Promise<InstanceProfile | undefined> {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    void vscode.window.showInformationMessage(
      'No saved instance profiles yet. Run "Terminal Sessions: Manage Instance Profiles" to create one.',
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    profiles.map((profile) => ({
      label: profile.name,
      description: describeProfile(profile),
      profile,
    })),
    { placeHolder, title: 'Instance Profiles' },
  );
  return picked?.profile;
}
