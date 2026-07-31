import * as vscode from 'vscode';
import { InstanceProfile } from './types';
import { wslShell } from './wsl';

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

  private get owned(): string[] {
    const current = this.memento.get<string[]>(OWNED_KEY);
    // Falling back matters: without it the extension would no longer recognise
    // entries it wrote before the rename, refuse to update them, and leave them
    // behind when their profile is deleted.
    return current ?? this.memento.get<string[]>(LEGACY_OWNED_KEY, []);
  }

  private setOwned(names: string[]): Thenable<void> {
    return this.memento.update(OWNED_KEY, [...new Set(names)]);
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
    const config = vscode.workspace.getConfiguration('terminal.integrated.profiles');
    const key = platformKey();
    const profiles = { ...(config.get<Record<string, unknown>>(key) ?? {}) };

    if (profiles[profile.name] !== undefined && !this.owned.includes(profile.name)) {
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
    await config.update(key, profiles, vscode.ConfigurationTarget.Global);
    await this.setOwned([...this.owned, profile.name]);
  }

  async remove(name: string): Promise<void> {
    if (!this.owned.includes(name)) {
      return; // Never touch a profile the user wrote themselves.
    }
    const config = vscode.workspace.getConfiguration('terminal.integrated.profiles');
    const key = platformKey();
    const profiles = { ...(config.get<Record<string, unknown>>(key) ?? {}) };

    if (profiles[name] !== undefined) {
      delete profiles[name];
      await config.update(key, profiles, vscode.ConfigurationTarget.Global);
    }
    await this.setOwned(this.owned.filter((owned) => owned !== name));
  }
}
