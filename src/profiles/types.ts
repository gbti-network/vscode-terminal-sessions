/**
 * A saved terminal recipe: how to open a shell, and what to run in it.
 *
 * Authored rather than captured, by necessity. At the moment you right-click a
 * terminal there is nothing readable to save: `creationOptions` comes back empty
 * for terminals VS Code launched from a profile, and shell integration cannot
 * see into a nested shell (a `claude` running inside `wsl` inside PowerShell is
 * invisible to it). So a profile is declared once and replayed thereafter.
 *
 * `commands` are stored and replayed **literally** — no placeholders, no
 * rewriting. Write `claude --continue` to rejoin the most recent conversation in
 * `cwd`, or `claude --resume <id>` to pin an exact one.
 */
export interface InstanceProfile {
  /** Display name, and the terminal's tab name. */
  name: string;
  /** WSL distro to enter. Implies `wsl.exe -d <distro>` as the shell. */
  distro?: string;
  /** Explicit shell, for non-WSL profiles. Ignored when `distro` is set. */
  shellPath?: string;
  shellArgs?: string[];
  /** Working directory. A Linux path when `distro` is set, else a host path. */
  cwd?: string;
  /**
   * Commands run in order once the shell is ready. Every command but the last
   * is awaited; the last is fired and left running, so a long-lived process
   * like `claude` belongs at the end.
   */
  commands: CommandEntry[];
  /**
   * Mirror this profile into `terminal.integrated.profiles.<platform>` so it
   * appears by name in VS Code's terminal `+` dropdown.
   *
   * Opt-in per profile because it duplicates the shell definition into settings
   * you also hand-edit, and the two copies can drift. The native schema has no
   * field for commands, so those stay here regardless.
   */
  showInDropdown?: boolean;
}

/**
 * How long to wait before a command runs.
 *
 * For the first command this is how long shell integration is given to
 * activate; for later ones it caps how long the previous command may take. It
 * is per-command because the right value is workload-specific — a version
 * manager needs a moment, a cold WSL bash needs longer, and a single `claude`
 * needs almost none. A single global timeout guessed wrong for all of them.
 */
export const DEFAULT_COMMAND_WAIT_MS = 3000;

export interface ProfileCommand {
  run: string;
  /** Milliseconds; defaults to {@link DEFAULT_COMMAND_WAIT_MS}. */
  waitMs?: number;
}

/** A plain string is shorthand for a command using the default wait. */
export type CommandEntry = string | ProfileCommand;

export function normalizeCommands(entries: readonly CommandEntry[] | undefined): ProfileCommand[] {
  return (entries ?? [])
    .map((entry) =>
      typeof entry === 'string'
        ? { run: entry, waitMs: DEFAULT_COMMAND_WAIT_MS }
        : { run: entry.run, waitMs: entry.waitMs ?? DEFAULT_COMMAND_WAIT_MS },
    )
    .filter((entry) => typeof entry.run === 'string' && entry.run.trim().length > 0);
}

/** Store the shorthand when the wait is the default, so simple profiles stay simple. */
export function compactCommands(commands: readonly ProfileCommand[]): CommandEntry[] {
  return commands.map((command) =>
    command.waitMs === undefined || command.waitMs === DEFAULT_COMMAND_WAIT_MS
      ? command.run
      : { run: command.run, waitMs: command.waitMs },
  );
}

export function isValidProfile(value: unknown): value is InstanceProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const profile = value as Partial<InstanceProfile>;
  return (
    typeof profile.name === 'string' &&
    profile.name.trim().length > 0 &&
    Array.isArray(profile.commands) &&
    profile.commands.every(
      (c) =>
        typeof c === 'string' ||
        (!!c && typeof c === 'object' && typeof (c as ProfileCommand).run === 'string'),
    )
  );
}

/** One-line summary for pickers and tooltips. */
export function describeProfile(profile: InstanceProfile): string {
  const where = profile.distro ? `${profile.distro}` : (profile.shellPath ?? 'default shell');
  const commands = normalizeCommands(profile.commands);
  const what = commands.length ? commands[commands.length - 1].run : 'no commands';
  return `${where} — ${what}`;
}
