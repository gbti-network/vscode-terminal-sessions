import * as vscode from 'vscode';
import {
  CommandEntry,
  DEFAULT_COMMAND_WAIT_MS,
  InstanceProfile,
  normalizeCommands,
} from './types';
import { warmDistro, wslShell } from './wsl';

/**
 * Terminals this extension opened and already replayed into.
 *
 * A mirrored profile can also be opened from VS Code's own `+` dropdown, which
 * this extension only learns about via `onDidOpenTerminal`. That listener
 * replays commands by matching the terminal name — so it has to skip the ones
 * we opened ourselves, or every launch would run its commands twice.
 */
const handled = new WeakSet<vscode.Terminal>();

export function markHandled(terminal: vscode.Terminal): void {
  handled.add(terminal);
}

export function wasHandled(terminal: vscode.Terminal): boolean {
  return handled.has(terminal);
}

/** Terminal options for a profile, without creating anything. */
export function terminalOptionsFor(
  profile: InstanceProfile,
  viewColumn?: vscode.ViewColumn,
): vscode.TerminalOptions {
  const options: vscode.TerminalOptions = { name: profile.name };

  if (profile.distro) {
    const { shellPath, shellArgs } = wslShell(profile.distro, profile.cwd);
    options.shellPath = shellPath;
    options.shellArgs = shellArgs;
  } else {
    options.shellPath = profile.shellPath;
    options.shellArgs = profile.shellArgs;
    // Only meaningful for host shells; a WSL profile passes cwd via `--cd`.
    options.cwd = profile.cwd;
  }

  if (viewColumn !== undefined) {
    options.location = { viewColumn, preserveFocus: true };
  }
  return options;
}

/**
 * Open a terminal for a profile and replay its commands.
 *
 * Waits for shell integration before sending anything. That is what makes this
 * race-free against a cold WSL boot: the alternative — baking commands into
 * `shellArgs` — works, but then those args are what the terminal reports
 * afterwards, which corrupts anything reading them back.
 */
export async function launchProfile(
  profile: InstanceProfile,
  viewColumn?: vscode.ViewColumn,
): Promise<vscode.Terminal> {
  // Progress in the status bar rather than silence: booting a cold distro and
  // waiting for the shell can take seconds, and with no feedback that reads as
  // a hang rather than as work happening.
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Opening ${profile.name}` },
    async (progress) => {
      if (profile.distro) {
        progress.report({ message: `starting ${profile.distro}...` });
        await warmDistro(profile.distro);
      }

      progress.report({ message: 'opening shell...' });
      const terminal = vscode.window.createTerminal(terminalOptionsFor(profile, viewColumn));
      markHandled(terminal);
      terminal.show(true);

      if (profile.commands.length > 0) {
        // Awaited so the progress indicator covers the wait for the shell,
        // which is the part that previously looked like nothing was happening.
        await replayCommands(terminal, profile.commands, progress);
      }
      return terminal;
    },
  );
}

/**
 * Replay commands into an existing terminal.
 *
 * Exported because a contributed terminal profile only returns *options* — VS
 * Code creates the terminal itself — so that path has to replay separately once
 * the terminal appears.
 */
export async function replayCommands(
  terminal: vscode.Terminal,
  entries: readonly CommandEntry[],
  progress?: vscode.Progress<{ message?: string }>,
): Promise<void> {
  const commands = normalizeCommands(entries);
  if (commands.length === 0) {
    return;
  }

  // The first command's wait doubles as the allowance for shell integration to
  // activate, which is the slow part on a cold WSL bash.
  progress?.report({ message: 'waiting for shell...' });
  const integration = await waitForShellIntegration(terminal, commands[0].waitMs);
  progress?.report({ message: 'running commands...' });

  let previous: vscode.TerminalShellExecution | undefined;

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const isLast = i === commands.length - 1;
    const wait = command.waitMs ?? DEFAULT_COMMAND_WAIT_MS;

    if (i > 0) {
      // Prefer a real completion signal, capped by this command's wait; without
      // shell integration there is no such signal, so fall back to pausing.
      if (previous) {
        await waitForCompletion(previous, wait);
      } else if (wait > 0) {
        await delay(wait);
      }
    }

    if (!integration) {
      // No shell integration: no readiness or completion signal, so typing into
      // the pty is the only option. The shell buffers it until it is ready.
      terminal.sendText(command.run, true);
      continue;
    }

    const execution = integration.executeCommand(command.run);
    // The last command is left running — a long-lived process like `claude`
    // belongs there, and awaiting it would hang forever.
    previous = isLast ? undefined : execution;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve when the terminal's shell integration activates, or give up. */
function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs = DEFAULT_COMMAND_WAIT_MS,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return Promise.resolve(terminal.shellIntegration);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(undefined);
    }, Math.max(0, timeoutMs));

    const subscription = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal === terminal) {
        clearTimeout(timer);
        subscription.dispose();
        resolve(event.shellIntegration);
      }
    });
  });
}

function waitForCompletion(
  execution: vscode.TerminalShellExecution,
  timeoutMs = DEFAULT_COMMAND_WAIT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, Math.max(0, timeoutMs));

    const subscription = vscode.window.onDidEndTerminalShellExecution((event) => {
      if (event.execution === execution) {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
  });
}
