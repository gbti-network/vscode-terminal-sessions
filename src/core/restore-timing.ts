/**
 * When session restore may safely begin, with no dependency on `vscode`.
 *
 * Restore has to run after VS Code has finished reviving its own terminals. Run
 * too early and every tracked profile gets a second tab: ours, plus the revived
 * one arriving afterwards. This used to be a single fixed wait
 * (`terminalSessions.restoreDelayMs`, 3000 ms), which is a guess about a machine
 * it cannot see, and nothing reconciled the duplicates when the guess was wrong.
 *
 * The rule here waits for the host to go *quiet* instead. That is deliberately
 * the conservative direction: the alternative, disposing tabs that turn up late,
 * would add another place where this extension destroys a terminal on
 * circumstantial evidence, which is the class of bug this release exists to
 * remove.
 */

export interface WaitPolicy {
  /** Never start before this. The user's `restoreDelayMs` is the floor. */
  floorMs: number;
  /** How long the host must go without opening a terminal. */
  quietMs: number;
  /** Start regardless once this much time has passed. */
  capMs: number;
}

export const DEFAULT_QUIET_MS = 1500;
export const DEFAULT_CAP_MS = 20_000;

export function policyFor(
  floorMs: number,
  quietMs: number = DEFAULT_QUIET_MS,
  capMs: number = DEFAULT_CAP_MS,
): WaitPolicy {
  const floor = Number.isFinite(floorMs) && floorMs > 0 ? floorMs : 0;
  // A cap below the floor would mean starting before the user's own delay, so
  // the floor always wins the argument.
  return { floorMs: floor, quietMs: Math.max(0, quietMs), capMs: Math.max(floor, capMs) };
}

/**
 * Whether to keep waiting.
 *
 * `sinceLastTerminalMs` is the time since a terminal last appeared, or
 * `undefined` when none has appeared at all since activation, which is itself
 * quiet.
 */
export function shouldKeepWaiting(
  policy: WaitPolicy,
  elapsedMs: number,
  sinceLastTerminalMs: number | undefined,
): boolean {
  if (elapsedMs < policy.floorMs) {
    return true;
  }
  if (elapsedMs >= policy.capMs) {
    // A host that never settles still restores, rather than waiting forever for
    // a quiet moment that is not coming.
    return false;
  }
  if (sinceLastTerminalMs === undefined) {
    return false;
  }
  return sinceLastTerminalMs < policy.quietMs;
}
