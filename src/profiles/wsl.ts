import { execFile } from 'child_process';

const WSL = 'wsl.exe';

/**
 * List installed WSL distros.
 *
 * `wsl.exe` writes UTF-16LE, so the output has to be decoded explicitly —
 * reading it as UTF-8 yields NUL-separated garbage. Returns an empty list on
 * any failure, including non-Windows hosts, so callers can just skip the
 * distro step rather than branch on platform.
 */
export function listWslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      WSL,
      ['--list', '--quiet'],
      { encoding: 'buffer', timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([]);
          return;
        }
        const text = Buffer.from(stdout).toString('utf16le');
        const distros = text
          .split(/\r?\n/)
          .map((line) => line.replace(/\0/g, '').trim())
          .filter((line) => line.length > 0);
        resolve(distros);
      },
    );
  });
}

/** Distros currently running, so an already-running one isn't booted again. */
export function listRunningDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      WSL,
      ['--list', '--running', '--quiet'],
      { encoding: 'buffer', timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([]);
          return;
        }
        resolve(
          Buffer.from(stdout)
            .toString('utf16le')
            .split(/\r?\n/)
            .map((line) => line.replace(/\0/g, '').trim())
            .filter(Boolean),
        );
      },
    );
  });
}

/**
 * Start a distro if it is not already running.
 *
 * Launching `wsl.exe -d <distro>` boots it anyway, but doing it first means the
 * terminal isn't waiting on a cold start before shell integration reports ready.
 * The running check matters: without it every launch paid for a redundant
 * `wsl.exe` process even when the distro was already up.
 */
export async function warmDistro(distro: string): Promise<boolean> {
  const running = await listRunningDistros();
  if (running.some((name) => name.toLowerCase() === distro.toLowerCase())) {
    return false;
  }
  await new Promise<void>((resolve) => {
    execFile(
      WSL,
      ['-d', distro, '--exec', '/bin/true'],
      { timeout: 30_000, windowsHide: true },
      () => resolve(),
    );
  });
  return true;
}

/** Shell configuration for entering a distro at a given directory. */
export function wslShell(distro: string, cwd?: string): { shellPath: string; shellArgs: string[] } {
  const args = ['-d', distro];
  if (cwd) {
    // `--cd` takes the Linux path directly, avoiding a leading `cd` command.
    args.push('--cd', cwd);
  }
  return { shellPath: WSL, shellArgs: args };
}
