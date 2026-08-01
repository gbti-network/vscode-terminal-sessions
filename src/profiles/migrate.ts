import * as vscode from 'vscode';
import {
  globalProfiles,
  hasWorkspace,
  moveToWorkspace,
  profileScope,
} from './registry';

/** Per-workspace, so declining in one project does not silence the others. */
const ASKED_KEY = 'terminalSessions.migrationOffered.v1';

/**
 * Offer to move globally saved profiles into this project.
 *
 * Profiles used to be global only, so anyone upgrading has a list that shows up
 * in every window. Rather than move them silently, which would rewrite settings
 * and bind them to whichever project happened to be open first, the offer is
 * made once per workspace and can be declined permanently.
 */
export async function offerMigration(context: vscode.ExtensionContext): Promise<void> {
  if (!hasWorkspace() || profileScope() !== 'workspace') {
    return;
  }
  if (context.workspaceState.get<boolean>(ASKED_KEY)) {
    return;
  }
  const candidates = globalProfiles();
  if (candidates.length === 0) {
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.name ?? 'this workspace';
  const choice = await vscode.window.showInformationMessage(
    `${candidates.length} terminal session profile${candidates.length === 1 ? '' : 's'} ` +
      `are saved globally, so they appear in every project. Move them into ${folder}?`,
    'Choose Profiles...',
    'Move All',
    'Keep Global',
  );

  // Dismissing asks again next time. Only an explicit answer settles it, since
  // a notification is easy to miss and this rewrites settings.
  if (!choice) {
    return;
  }
  await context.workspaceState.update(ASKED_KEY, true);

  if (choice === 'Keep Global') {
    return;
  }

  const names =
    choice === 'Move All'
      ? candidates.map((profile) => profile.name)
      : ((
          await vscode.window.showQuickPick(
            candidates.map((profile) => ({ label: profile.name, picked: true })),
            { canPickMany: true, placeHolder: `Move which profiles into ${folder}?` },
          )
        )?.map((item) => item.label) ?? []);

  const moved = await moveToWorkspace(names);
  if (moved > 0) {
    void vscode.window.showInformationMessage(
      `Moved ${moved} profile${moved === 1 ? '' : 's'} into ${folder}. ` +
        'They now live in this project\'s settings.',
    );
  }
}

/** The same move, on demand from the palette. */
export async function migrateCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!hasWorkspace()) {
    void vscode.window.showWarningMessage(
      'Open a folder first: workspace settings cannot be written in a window with no project.',
    );
    return;
  }
  const candidates = globalProfiles();
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('No global profiles to move.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((profile) => ({ label: profile.name, picked: true })),
    { canPickMany: true, placeHolder: 'Move which profiles into this workspace?' },
  );
  if (!picked?.length) {
    return;
  }
  await context.workspaceState.update(ASKED_KEY, true);
  const moved = await moveToWorkspace(picked.map((item) => item.label));
  void vscode.window.showInformationMessage(
    `Moved ${moved} profile${moved === 1 ? '' : 's'} into this workspace.`,
  );
}
