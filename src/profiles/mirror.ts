import * as vscode from 'vscode';
import { InstanceProfile } from './types';
import { wslShell } from './wsl';
import { hasWorkspace, ProfileScope, profileScope, scopeOf } from './registry';

const NATIVE = 'terminal.integrated.profiles';

/**
 * Mirror a profile at the same scope it is stored at.
 *
 * A workspace profile mirrored globally would appear in the terminal dropdown
 * of every other project, which is the exact leak workspace scoping exists to
 * stop. `terminal.integrated.profiles.*` is a restricted setting, so a
 * workspace value is ignored until the workspace is trusted; that is a better
 * failure than a profile following you everywhere.
 */
function targetFor(name: string): ProfileScope {
  const scope = scopeOf(name) ?? profileScope();
  return scope === 'workspace' && hasWorkspace() ? 'workspace' : 'global';
}

function configTarget(scope: ProfileScope): vscode.ConfigurationTarget {
  return scope === 'global'
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;
}

/**
 * The value written at one scope, not the resolved one.
 *
 * `get` merges objects across scopes, so writing that back at a single target
 * would copy every other scope's entries into it.
 */
function ownValue(scope: ProfileScope, key: string): Record<string, unknown> {
  const values = vscode.workspace.getConfiguration(NATIVE).inspect<Record<string, unknown>>(key);
  const raw =
    scope === 'global'
      ? values?.globalValue
      : (values?.workspaceFolderValue ?? values?.workspaceValue);
  return { ...(raw ?? {}) };
}

/** Which platform key `terminal.integrated.profiles.*` uses on this machine. */
function platformKey(): string {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'osx';
    default:
      return 'linux';
  }
}

const OWNED_KEY = 'terminalSessions.mirroredProfiles';
/** Pre-rename key, read once so existing mirrors stay ours to manage. */
const LEGACY_OWNED_KEY = 'kanban.mirroredProfiles';

/**
 * Mirrors profiles into VS Code's native terminal profiles, so each appears by
 * name in the `+` dropdown.
 *
 * The native schema holds `path`, `args`, `env`, `icon`, `color` and
 * `overrideName` — and nothing else. There is no field for a working directory
 * or for commands, so commands stay in `terminalSessions.instanceProfiles` and the cwd is
 * folded into `args` as `--cd` for WSL.
 *
 * Every write is tracked, and a key this extension did not create is never
 * modified or removed. That matters because the user hand-edits this same
 * settings object.
 */
export class ProfileMirror {
  constructor(private readonly memento: vscode.Memento) {}

  /**
   * Names this extension wrote, tagged with the scope it wrote them at.
   *
   * Stored as `name@scope`. Ownership used to be a bare name, so removing a
   * profile mirrored globally also deleted a same-named native profile the user
   * had written in their workspace settings. A bare entry from an older version
   * still means both scopes, which is what it meant when it was written.
   */
  private get owned(): string[] {
    const current = this.memento.get<string[]>(OWNED_KEY);
    // Falling back matters: without it the extension would no longer recognise
    // entries it wrote before the rename, refuse to update them, and leave them
    // behind when their profile is deleted.
    return current ?? this.memento.get<string[]>(LEGACY_OWNED_KEY, []);
  }

  /** Whether we wrote this name, at any scope. */
  private ownsName(name: string): boolean {
    return this.owned.some((entry) => entry === name || entry.startsWith(`${name}@`));
  }

  /** Whether we wrote this name at this particular scope. */
  private ownsAt(name: string, scope: ProfileScope): boolean {
    return this.owned.some((entry) => entry === name || entry === `${name}@${scope}`);
  }

  private setOwned(names: string[]): Thenable<void> {
    return this.memento.update(OWNED_KEY, [...new Set(names)]);
  }

  private forget(name: string): string[] {
    return this.owned.filter((entry) => entry !== name && !entry.startsWith(`${name}@`));
  }

  /** Add, update or remove a profile's native mirror to match `showInDropdown`. */
  async sync(profile: InstanceProfile, previousName?: string): Promise<void> {
    if (previousName && previousName !== profile.name) {
      await this.remove(previousName);
    }
    if (profile.showInDropdown) {
      await this.write(profile);
    } else {
      await this.remove(profile.name);
    }
  }

  private async write(profile: InstanceProfile): Promise<void> {
    const config = vscode.workspace.getConfiguration(NATIVE);
    const key = platformKey();
    const scope = targetFor(profile.name);
    const profiles = ownValue(scope, key);

    // Checked against the *resolved* value, because a name colliding with one
    // the user wrote at any scope is still a collision.
    const resolved = config.get<Record<string, unknown>>(key) ?? {};
    if (resolved[profile.name] !== undefined && !this.ownsName(profile.name)) {
      void vscode.window.showWarningMessage(
        `A terminal profile named "${profile.name}" already exists in your settings and was not written to. Rename the instance profile to mirror it.`,
      );
      return;
    }

    const entry: Record<string, unknown> = profile.distro
      ? (() => {
          const { shellPath, shellArgs } = wslShell(profile.distro!, profile.cwd);
          return { path: shellPath, args: shellArgs, icon: 'server' };
        })()
      : { path: profile.shellPath, args: profile.shellArgs ?? [] };

    if (!entry.path) {
      // A host-shell profile with no explicit path has nothing to mirror; the
      // native schema requires `path`.
      void vscode.window.showWarningMessage(
        `"${profile.name}" needs an explicit shell path before it can appear in the terminal dropdown.`,
      );
      return;
    }

    profiles[profile.name] = entry;
    await config.update(key, profiles, configTarget(scope));
    await this.setOwned([...this.owned, `${profile.name}@${scope}`]);
  }

  async remove(name: string): Promise<void> {
    if (!this.ownsName(name)) {
      return; // Never touch a profile the user wrote themselves.
    }
    const config = vscode.workspace.getConfiguration(NATIVE);
    const key = platformKey();

    // Both scopes are considered, because a profile may have been mirrored
    // globally before it moved into a workspace and leaving the old entry behind
    // would keep it in every project's dropdown. But each is only touched if we
    // wrote it there: a same-named entry the user added at the other scope is
    // theirs, and deleting it was the leak in reverse.
    for (const scope of ['workspace', 'global'] as const) {
      if (scope === 'workspace' && !hasWorkspace()) {
        continue;
      }
      if (!this.ownsAt(name, scope)) {
        continue;
      }
      const profiles = ownValue(scope, key);
      if (profiles[name] !== undefined) {
        delete profiles[name];
        await config.update(key, profiles, configTarget(scope));
      }
    }
    await this.setOwned(this.forget(name));
  }
}
