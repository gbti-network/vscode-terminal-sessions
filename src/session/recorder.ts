import * as vscode from 'vscode';
import {
  CONFIDENCE_NAMES,
  ObservedCommand,
  RecordedTerminal,
  extractSessionId,
  isClaudeCommand,
  parseWsl,
} from './types';

/**
 * Event-derived state per terminal.
 *
 * Deliberately does NOT cache `name` or `creationOptions`. VS Code resolves a
 * terminal's profile *after* `onDidOpenTerminal` fires, so anything read at open
 * time is empty for profile-launched terminals — including the name. Those are
 * read live from the `Terminal` at snapshot time instead.
 */
interface Tracked {
  cwd?: string;
  claudeSessionId?: string;
  /** Executions still running, so a finished `ls` never looks restorable. */
  running: Map<string, ObservedCommand>;
}

/**
 * Watches terminals and records what is running in them.
 *
 * Continuous by necessity, not by preference: `Terminal` exposes no property for
 * the command it is running, so `onDidStartTerminalShellExecution` is the only
 * way to learn it, and only while it happens. By the time a window is closing
 * there is nothing left to ask.
 */
export class SessionRecorder implements vscode.Disposable {
  private readonly tracked = new Map<vscode.Terminal, Tracked>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly log: vscode.OutputChannel;
  /** Session ids handed out by our own launcher, keyed by terminal name. */
  private readonly assigned = new Map<string, string>();

  constructor() {
    this.log = vscode.window.createOutputChannel('Terminal Sessions');
    this.disposables.push(this.log);

    for (const terminal of vscode.window.terminals) {
      this.track(terminal, 'existing');
    }

    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => this.track(terminal, 'opened')),
      vscode.window.onDidCloseTerminal((terminal) => {
        this.tracked.delete(terminal);
        this.write(`closed: ${terminal.name}`);
      }),
      vscode.window.onDidChangeTerminalShellIntegration(({ terminal, shellIntegration }) => {
        const entry = this.tracked.get(terminal) ?? this.track(terminal, 'integration');
        const cwd = shellIntegration.cwd?.fsPath;
        if (cwd && cwd !== entry.cwd) {
          entry.cwd = cwd;
          this.write(`cwd: ${terminal.name} -> ${cwd}`);
        }
      }),
      vscode.window.onDidStartTerminalShellExecution(({ terminal, execution }) => {
        const entry = this.tracked.get(terminal) ?? this.track(terminal, 'execution');
        const line = execution.commandLine;
        const observed: ObservedCommand = {
          commandLine: line.value,
          confidence: CONFIDENCE_NAMES[line.confidence] ?? String(line.confidence),
          isTrusted: line.isTrusted,
        };
        entry.running.set(line.value, observed);

        if (isClaudeCommand(line.value)) {
          const id = extractSessionId(line.value);
          if (id) {
            entry.claudeSessionId = id;
          }
          this.write(
            `claude started: ${terminal.name}\n` +
              `  command:    ${line.value}\n` +
              `  confidence: ${observed.confidence}  trusted: ${observed.isTrusted}\n` +
              `  sessionId:  ${entry.claudeSessionId ?? '(none — restore would use --continue)'}`,
          );
        }
      }),
      vscode.window.onDidEndTerminalShellExecution(({ terminal, execution }) => {
        // Only commands still running are worth restoring, so drop it on exit.
        this.tracked.get(terminal)?.running.delete(execution.commandLine.value);
      }),
    );
  }

  /** Note a session id we chose ourselves, before the terminal exists. */
  rememberAssignedSession(terminalName: string, sessionId: string): void {
    this.assigned.set(terminalName, sessionId);
  }

  /**
   * The current recordable state of every open terminal.
   *
   * Name and shell options are read from the live `Terminal` here, not from
   * anything cached at open time — see the note on `Tracked`.
   */
  snapshot(): RecordedTerminal[] {
    const records: RecordedTerminal[] = [];
    for (const [terminal, entry] of this.tracked) {
      const options = readCreationOptions(terminal);
      const { isWsl, distro } = parseWsl(options.shellPath, options.shellArgs);
      records.push({
        name: terminal.name,
        cwd: entry.cwd ?? options.cwd,
        shellPath: options.shellPath,
        shellArgs: options.shellArgs,
        isWsl,
        distro,
        claudeSessionId: entry.claudeSessionId ?? this.assigned.get(terminal.name),
        claudeRunning: [...entry.running.keys()].some(isClaudeCommand),
      });
    }
    return records;
  }

  /**
   * Dump the model for inspection.
   *
   * Phase 1 exists to answer one question with this: are `shellPath` and
   * `shellArgs` actually populated for a terminal launched from a *profile*
   * rather than by an extension? The whole restore path assumes they are.
   */
  async dump(): Promise<void> {
    const records = this.snapshot();
    this.write('='.repeat(60));
    this.write(`snapshot: ${records.length} terminal(s)`);

    for (const [terminal] of this.tracked) {
      const record = records.find((r) => r.name === terminal.name);
      if (!record) {
        continue;
      }
      // Liveness is the point of this dump after a restart: a revived terminal
      // can look identical to a live one while its shell is actually dead.
      // `exitStatus` set, or no pid, means the process did not survive.
      const pid = await terminal.processId;
      const exit = terminal.exitStatus;
      const alive = exit === undefined && pid !== undefined;

      this.write(
        [
          `  ${record.name}`,
          `    process:    ${alive ? `ALIVE (pid ${pid})` : `DEAD${exit ? ` (exit ${exit.code ?? '?'})` : ' (no pid)'}`}`,
          `    integration:${terminal.shellIntegration ? ' active' : ' none'}`,
          `    cwd:        ${record.cwd ?? '(unknown — no shell integration)'}`,
          `    shellPath:  ${record.shellPath ?? '(EMPTY — profile args not exposed)'}`,
          `    shellArgs:  ${formatArgs(record.shellArgs)}`,
          `    wsl:        ${record.isWsl ? `yes, distro=${record.distro ?? '(default)'}` : 'no'}`,
          `    claude:     ${describeClaude(record)}`,
        ].join('\n'),
      );
    }
    this.log.show(true);
  }

  private track(terminal: vscode.Terminal, reason: string): Tracked {
    const existing = this.tracked.get(terminal);
    if (existing) {
      return existing;
    }

    const entry: Tracked = {
      cwd: readCreationOptions(terminal).cwd,
      claudeSessionId: this.assigned.get(terminal.name),
      running: new Map(),
    };
    this.tracked.set(terminal, entry);
    // Options are not logged here: at open time the profile is usually
    // unresolved, so they would read empty and mislead. `dump` reads them live.
    this.write(`${reason}: ${terminal.name || '(name pending)'}`);
    return entry;
  }

  private write(message: string): void {
    this.log.appendLine(message);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.tracked.clear();
  }
}

/**
 * `creationOptions` is a union: `ExtensionTerminalOptions` describes a
 * pty-backed terminal and carries no shell at all, so it has to be excluded
 * before reading shell fields.
 */
function readCreationOptions(terminal: vscode.Terminal): {
  shellPath?: string;
  shellArgs?: string[] | string;
  cwd?: string;
} {
  const options = terminal.creationOptions;
  if ('pty' in options) {
    return {};
  }
  const cwd = options.cwd;
  return {
    shellPath: options.shellPath,
    shellArgs: options.shellArgs,
    cwd: typeof cwd === 'string' ? cwd : cwd?.fsPath,
  };
}

function formatArgs(args: string[] | string | undefined): string {
  if (args === undefined) {
    return '(empty)';
  }
  return Array.isArray(args) ? JSON.stringify(args) : JSON.stringify([args]);
}

function describeClaude(record: RecordedTerminal): string {
  if (record.claudeSessionId) {
    return `session ${record.claudeSessionId} (restore: --resume)`;
  }
  if (record.claudeRunning) {
    return 'running, id unknown (restore: --continue)';
  }
  return 'not running (restore: placeholder only)';
}
