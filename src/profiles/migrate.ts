import * as vscode from 'vscode';
import { globalProfiles, hasWorkspace, moveToWorkspace } from './registry';

/**
 * Bulk-move globally saved profiles into this project.
 *
 * Deliberately palette-only. This used to be offered as a notification on
 * startup, which was the wrong shape: a toast interrupts before you have any
 * context, and scope is a property of a profile rather than a one-time
 * migration. The profile editor's own "Saved in" control is the primary way to
 * move one; this is the shortcut for moving several at once.
 */
export async function migrateCommand(_context: vscode.ExtensionContext): Promise<void> {
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
  const moved = await moveToWorkspace(picked.map((item) => item.label));
  void vscode.window.showInformationMessage(
    `Moved ${moved} profile${moved === 1 ? '' : 's'} into this workspace.`,
  );
}
