import * as vscode from 'vscode';
import { InstanceProfile } from '../profiles/types';
import { getProfiles } from '../profiles/registry';
import { launchProfile } from '../profiles/launcher';

const KEY = 'terminalSessions.session.v1';
/** Pre-rename key, so tracked sessions survive the rename. */
const LEGACY_KEY = 'kanban.session.v1';

interface TrackedLaunch {
  /** Profile name, which is also the terminal's tab name. */
  name: string;
  /** Process id at launch. The evidence that distinguishes revived from alive. */
  pid?: number;
}

interface SessionState {
  version: 1;
  launched: TrackedLaunch[];
}

/**
 * Remembers which profiles were open, and puts them back after a restart.
 *
 * The subtlety is telling a *revived* terminal from a *surviving* one. VS Code
 * brings tabs and names back, but a revived tab is a fresh default-profile shell
 * with replayed scrollback — the WSL shell and whatever ran in it are gone. Yet
 * on a window reload the real process often does survive.
 *
 * Both cases look identical by name, so the pid recorded at launch is the
 * discriminator: same pid means the process is genuinely still alive and must be
 * left alone; a different pid (or none) means the tab is a corpse and can be
 * replaced. Getting this wrong would kill a live Claude session, so it is
 * checked rather than assumed.
 */
export class SessionRestorer implements vscode.Disposable {
  private readonly statusItem: vscode.StatusBarItem;
  private state: SessionState;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored =
      context.workspaceState.get<SessionState>(KEY) ??
      context.workspaceState.get<SessionState>(LEGACY_KEY);
    this.state = stored?.version === 1 ? stored : { version: 1, launched: [] };

    // Priority below the column chips (100/99/98) so it sits to their right.
    this.statusItem = vscode.window.createStatusBarItem(
      'terminalSessions.session.restore',
      vscode.StatusBarAlignment.Left,
      90,
    );
    this.statusItem.name = 'Terminal Sessions: Restore Session';
    this.statusItem.command = 'terminalSessions.restoreSession';
    this.refresh();
  }

  /** Record a profile launch, including its pid once the process exists. */
  async track(profile: InstanceProfile, terminal: vscode.Terminal): Promise<void> {
    const pid = await terminal.processId;
    this.state.launched = this.state.launched.filter((entry) => entry.name !== profile.name);
    this.state.launched.push({ name: profile.name, pid });
    await this.flush();
    this.refresh();
  }

  /** Forget a profile, so it is not restored next time. */
  async forget(name: string): Promise<void> {
    this.state.launched = this.state.launched.filter((entry) => entry.name !== name);
    await this.flush();
    this.refresh();
  }

  get pending(): number {
    return this.state.launched.length;
  }

  /**
   * Put the recorded profiles back.
   *
   * Returns a summary of what happened, so the caller can report it rather than
   * silently rearranging the user's terminals.
   */
  async restore(): Promise<{ relaunched: string[]; kept: string[]; missing: string[] }> {
    const relaunched: string[] = [];
    const kept: string[] = [];
    const missing: string[] = [];

    for (const entry of [...this.state.launched]) {
      const profile = getProfiles().find((p) => p.name === entry.name);
      if (!profile) {
        missing.push(entry.name);
        continue;
      }

      const existing = vscode.window.terminals.find((t) => t.name === entry.name);
      if (existing) {
        const pid = await existing.processId;
        if (pid !== undefined && pid === entry.pid) {
          // Same process: it genuinely survived. Leave it be.
          kept.push(entry.name);
          continue;
        }
        // Different pid means a revived shell wearing the old name.
        existing.dispose();
      }

      const terminal = await launchProfile(profile);
      await this.track(profile, terminal);
      relaunched.push(entry.name);
    }

    this.refresh();
    return { relaunched, kept, missing };
  }

  private refresh(): void {
    const count = this.state.launched.length;
    if (count === 0) {
      this.statusItem.hide();
      return;
    }
    this.statusItem.text = `$(history) Restore (${count})`;
    this.statusItem.tooltip = `Reopen ${count} saved session${count === 1 ? '' : 's'}: ${this.state.launched
      .map((entry) => entry.name)
      .join(', ')}`;
    this.statusItem.show();
  }

  private flush(): Thenable<void> {
    return this.context.workspaceState.update(KEY, this.state);
  }

  dispose(): void {
    this.statusItem.dispose();
  }
}
