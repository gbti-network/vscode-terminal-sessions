/**
 * What we know about one open terminal, and everything needed to bring it back.
 *
 * Only `claudeSessionId` ever leads to a command being executed on restore.
 * Everything else describes a *placeholder*: same name, same directory, same
 * shell, empty prompt. That is deliberate — see the SOW's resolved question 5.
 */
export interface RecordedTerminal {
  /** Terminal name as shown on its tab. */
  name: string;
  /** Working directory, from shell integration when available. */
  cwd?: string;
  /** Executable backing the shell, e.g. `C:\WINDOWS\System32\wsl.exe`. */
  shellPath?: string;
  shellArgs?: string[] | string;
  /** True when the shell is `wsl.exe`, whether or not a distro was named. */
  isWsl: boolean;
  /** Distro from `-d` / `--distribution`; absent means WSL's default. */
  distro?: string;
  /**
   * Claude session to rejoin. Set when this extension launched Claude here (we
   * chose the id), or when an observed command line carried one explicitly.
   */
  claudeSessionId?: string;
  /**
   * A `claude` process was seen running but we have no id for it. Restore falls
   * back to `--continue`, which takes the most recent conversation in `cwd`.
   */
  claudeRunning: boolean;
}

/** Diagnostics captured per observed shell execution, for phase-1 validation. */
export interface ObservedCommand {
  commandLine: string;
  /** `Low` means the value was scraped from the buffer, not reported by the shell. */
  confidence: string;
  isTrusted: boolean;
}

export const CONFIDENCE_NAMES = ['Low', 'Medium', 'High'];

/** Does this command line start the Claude CLI? */
export function isClaudeCommand(commandLine: string): boolean {
  const first = commandLine.trim().split(/\s+/)[0] ?? '';
  const base = first.replace(/\\/g, '/').split('/').pop() ?? '';
  return /^claude(\.cmd|\.exe)?$/i.test(base);
}

/**
 * Pull a session id out of a command line.
 *
 * Covers `--session-id <uuid>` (what this extension passes) and
 * `--resume <uuid>`, so a hand-started session that names its id explicitly
 * gets the same exact restore as one we launched.
 */
export function extractSessionId(commandLine: string): string | undefined {
  const match = commandLine.match(
    /--(?:session-id|resume)[= ]+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  );
  return match?.[1];
}

/** Identify a WSL shell and, if named, its distro. */
export function parseWsl(
  shellPath?: string,
  shellArgs?: string[] | string,
): { isWsl: boolean; distro?: string } {
  const base = (shellPath ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  if (!/^wsl(\.exe)?$/i.test(base)) {
    return { isWsl: false };
  }
  const args = Array.isArray(shellArgs)
    ? shellArgs
    : shellArgs
      ? shellArgs.split(/\s+/)
      : [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d' || args[i] === '--distribution') {
      return { isWsl: true, distro: args[i + 1] };
    }
  }
  return { isWsl: true };
}
