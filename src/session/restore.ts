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
  private state: SessionState;
  /** The pass in flight, so a second caller joins it rather than racing it. */
  private running?: Promise<{ relaunched: string[]; kept: string[]; missing: string[] }>;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored =
      context.workspaceState.get<SessionState>(KEY) ??
      context.workspaceState.get<SessionState>(LEGACY_KEY);
    this.state = stored?.version === 1 ? stored : { version: 1, launched: [] };

  }

  /** Record a profile launch, including its pid once the process exists. */
  async track(profile: InstanceProfile, terminal: vscode.Terminal): Promise<void> {
    const pid = await terminal.processId;
    this.state.launched = this.state.launched.filter((entry) => entry.name !== profile.name);
    this.state.launched.push({ name: profile.name, pid });
    await this.flush();
  }

  /** Forget a profile, so it is not restored next time. */
  async forget(name: string): Promise<void> {
    this.state.launched = this.state.launched.filter((entry) => entry.name !== name);
    await this.flush();
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
    // One pass at a time. Startup schedules this on a timer and the palette
    // offers it as a command, so a user running it while the startup pass is
    // still launching had two passes reading the same list, each disposing and
    // relaunching what the other had just made.
    if (this.running) {
      return this.running;
    }
    this.running = this.runRestore().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async runRestore(): Promise<{
    relaunched: string[];
    kept: string[];
    missing: string[];
  }> {
    const relaunched: string[] = [];
    const kept: string[] = [];
    const missing: string[] = [];

    for (const entry of [...this.state.launched]) {
      const profile = getProfiles().find((p) => p.name === entry.name);
      if (!profile) {
        missing.push(entry.name);
        // Drop it rather than reporting the same absence on every window open.
        // Nothing cleared these: `forget` is only reachable from a picker that
        // lists profiles that still exist, so a deleted profile's entry was
        // unreachable through the UI and complained forever. The caller still
        // reports it once, here, which is the notice the user needs.
        await this.forget(entry.name);
        continue;
      }

      // Every terminal wearing this name, not just the first. `track` records
      // one pid per name, so with two same-named terminals the first match was
      // often the older, live one: it failed the pid test against the newer
      // record and was disposed while the process it held was still running.
      const named = vscode.window.terminals.filter((t) => t.name === entry.name);
      const pids = await Promise.all(named.map((terminal) => terminal.processId));

      if (named.length) {
        const survived = named.some(
          (_, index) => pids[index] !== undefined && pids[index] === entry.pid,
        );
        if (survived) {
          kept.push(entry.name);
          continue;
        }
        if (entry.pid === undefined) {
          // No pid was ever recorded, so there is no evidence this tab is a
          // corpse. Disposing on an absence of evidence is how a live session
          // gets killed; leaving a duplicate is the cheaper mistake.
          kept.push(entry.name);
          continue;
        }
        // Every match failed the pid test, so each is a revived shell wearing
        // the name rather than the process that was launched under it.
        for (const terminal of named) {
          terminal.dispose();
        }
      }

      const terminal = await launchProfile(profile);
      await this.track(profile, terminal);
      relaunched.push(entry.name);
    }

    return { relaunched, kept, missing };
  }

  private flush(): Thenable<void> {
    return this.context.workspaceState.update(KEY, this.state);
  }

  /**
   * Nothing to tear down.
   *
   * There used to be a `Restore (N)` status bar chip here. It only ever offered
   * to redo something `autoRestoreSession` had already done on startup, so it
   * read as a control with an unclear job while adding permanent noise beside
   * the column chips, which are the status bar's actual feature. Restore Last
   * Session remains in the palette for the one case automation misses: running
   * it again after closing a restored terminal by hand.
   */
  dispose(): void {}
}
