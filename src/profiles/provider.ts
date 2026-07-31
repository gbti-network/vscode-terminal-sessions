import * as vscode from 'vscode';
import { pickProfile } from './author';
import { terminalOptionsFor } from './launcher';
import { warmDistro } from './wsl';

/** Must match the `id` declared in `contributes.terminal.profiles`. */
export const SAVED_SESSION_PROFILE_ID = 'terminalSessions.savedSession';

/**
 * Puts "Terminal Sessions: Saved Session…" in VS Code's native terminal `+` dropdown.
 *
 * Contributed profile ids are static in `package.json`, so one native entry per
 * saved profile is impossible. But `provideTerminalProfile` is async, so a
 * single declared entry can ask which saved profile you want and return that
 * one — giving unlimited profiles from one static declaration.
 *
 * Note this returns *options* rather than a terminal: VS Code creates it. The
 * commands are therefore replayed by the caller watching for the terminal to
 * appear, not here.
 */
export function registerSavedSessionProfile(
  onTerminalCreated: (name: string) => void,
): vscode.Disposable {
  return vscode.window.registerTerminalProfileProvider(SAVED_SESSION_PROFILE_ID, {
    async provideTerminalProfile(token: vscode.CancellationToken) {
      const profile = await pickProfile('Open which saved session?');
      if (!profile || token.isCancellationRequested) {
        return undefined;
      }
      if (profile.distro) {
        await warmDistro(profile.distro);
      }
      onTerminalCreated(profile.name);
      return new vscode.TerminalProfile(terminalOptionsFor(profile));
    },
  });
}
