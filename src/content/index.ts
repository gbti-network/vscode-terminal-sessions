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
