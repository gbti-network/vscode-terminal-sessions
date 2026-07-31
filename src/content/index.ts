import * as vscode from 'vscode';
import { ColumnDef } from '../columns/types';

const PANEL_POSITION_COMMANDS: Record<string, string> = {
  left: 'workbench.action.positionPanelLeft',
  right: 'workbench.action.positionPanelRight',
  top: 'workbench.action.positionPanelTop',
  bottom: 'workbench.action.positionPanelBottom',
};

async function run(command: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * The command that hides and shows the editor area, resolved once.
 *
 * `workbench.action.toggleEditorVisibility` is the named one, but it is only
 * confirmed present on recent hosts and `engines.vscode` allows 1.88. Its whole
 * body is `toggleMaximizedPanel()`, so falling back to that command directly is
 * not an approximation — it is the same call, and it is old enough to rely on.
 *
 * `undefined` means neither exists and the editor column cannot be supported;
 * callers drop the column rather than offering a chip that does nothing.
 */
const EDITOR_TOGGLE_CANDIDATES = [
  'workbench.action.toggleEditorVisibility',
  'workbench.action.toggleMaximizedPanel',
];

let editorToggle: string | undefined;
let editorToggleResolved = false;

export async function resolveEditorToggle(): Promise<string | undefined> {
  if (!editorToggleResolved) {
    const available = new Set(await vscode.commands.getCommands(true));
    editorToggle = EDITOR_TOGGLE_CANDIDATES.find((id) => available.has(id));
    editorToggleResolved = true;
  }
  return editorToggle;
}

/** Whether this host can hide the editor area at all. */
export async function editorColumnSupported(): Promise<boolean> {
  return (await resolveEditorToggle()) !== undefined;
}

/**
 * Flip the editor area.
 *
 * There is no absolute show/hide pair for it — the full panel command surface
 * is toggle/close/focus plus the position and alignment commands, with no
 * `maximizePanel`. Issuing a toggle is therefore only correct because
 * `LayoutEngine.apply` fires on a *change*, so this is never called when the
 * state already matches.
 *
 * That contract is load-bearing in one place beyond `apply` itself: when the
 * workbench moves the editor area on its own — closing a maximized panel
 * restores it — `setHidden` records the new state *and* pre-seeds `applied`, so
 * no toggle reaches here to undo what already happened.
 */
async function toggleEditor(): Promise<boolean> {
  const command = await resolveEditorToggle();
  return command ? run(command) : false;
}

/** Show a column's container. */
export async function revealColumn(def: ColumnDef): Promise<boolean> {
  switch (def.kind) {
    case 'sidebar':
      return run(def.viewId ?? 'workbench.view.explorer');
    case 'panel': {
      // Position before revealing, or the panel reappears on its old edge.
      const position = PANEL_POSITION_COMMANDS[def.position ?? 'right'];
      if (position) {
        await run(position);
      }
      return run(def.viewId ?? 'workbench.action.focusPanel');
    }
    case 'auxiliaryBar':
      return run(def.viewId ?? 'workbench.action.focusAuxiliaryBar');
    case 'editor':
      return toggleEditor();
  }
}

/** Hide a column's container. */
export async function hideColumn(def: ColumnDef): Promise<boolean> {
  switch (def.kind) {
    case 'sidebar':
      return run('workbench.action.closeSidebar');
    case 'panel':
      return run('workbench.action.closePanel');
    case 'auxiliaryBar':
      return run('workbench.action.closeAuxiliaryBar');
    case 'editor':
      return toggleEditor();
  }
}

/**
 * Nudge the focused part's size using VS Code's own commands.
 *
 * These already act on whatever has focus — sidebar, panel, aux bar or editor
 * group — and VS Code persists the result. Reimplementing that would be worse:
 * no API can read a container's width back.
 */
export async function resizeFocused(grow: boolean): Promise<boolean> {
  return run(
    grow ? 'workbench.action.increaseViewSize' : 'workbench.action.decreaseViewSize',
  );
}
