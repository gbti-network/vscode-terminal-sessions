import * as vscode from 'vscode';
import { ColumnDef, PanelPosition } from './types';

/**
 * Defaults: Explorer on the left, the editor next to it, terminal panel on the
 * right, chat in the secondary sidebar — listed in the order they sit on
 * screen, which is also the order the chips appear.
 *
 * These are the real VS Code containers, which matters. The terminal view is
 * the only place its right-hand terminal list exists, the auxiliary bar holds
 * the actual Claude and Codex shells (Codex's editor-area panel is a different
 * webview entirely), and a hand-rolled file tree could not read other
 * extensions' file decorations. VS Code also persists these containers' widths
 * itself, including sash drags no API can observe.
 */
export const DEFAULT_COLUMNS: ColumnDef[] = [
  {
    id: 'files',
    label: 'FILES',
    kind: 'sidebar',
    viewId: 'workbench.view.explorer',
  },
  {
    id: 'editor',
    label: 'EDITOR',
    kind: 'editor',
  },
  {
    id: 'terminal',
    label: 'TERMINAL',
    kind: 'panel',
    position: 'right',
  },
  {
    id: 'chat',
    label: 'CHAT',
    kind: 'auxiliaryBar',
  },
];

const COLUMN_KINDS: ReadonlySet<string> = new Set([
  'sidebar',
  'panel',
  'auxiliaryBar',
  'editor',
]);
const PANEL_POSITIONS: ReadonlySet<string> = new Set(['left', 'right', 'top', 'bottom']);

/** Read user-configured columns, falling back to the defaults. */
export function getColumns(): ColumnDef[] {
  const configured = vscode.workspace
    .getConfiguration('terminalSessions')
    .get<Partial<ColumnDef>[]>('columns', []);

  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_COLUMNS.map((c) => ({ ...c }));
  }

  const seen = new Set<string>();
  const columns: ColumnDef[] = [];

  for (const raw of configured) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.label !== 'string') {
      continue;
    }
    if (!isColumnKind(raw.kind) || seen.has(raw.id)) {
      continue;
    }
    seen.add(raw.id);
    columns.push({
      id: raw.id,
      label: raw.label,
      kind: raw.kind,
      viewId: typeof raw.viewId === 'string' ? raw.viewId : undefined,
      position: isPanelPosition(raw.position) ? raw.position : undefined,
    });
  }

  return columns.length > 0 ? columns : DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

function isColumnKind(value: unknown): value is ColumnDef['kind'] {
  return typeof value === 'string' && COLUMN_KINDS.has(value);
}

function isPanelPosition(value: unknown): value is PanelPosition {
  return typeof value === 'string' && PANEL_POSITIONS.has(value);
}
