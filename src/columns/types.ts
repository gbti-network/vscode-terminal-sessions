/**
 * The three workbench containers that can be shown and hidden independently.
 *
 * The editor is deliberately not one of them: it is the space left over once
 * these three have taken theirs, so there is nothing to hide it into.
 */
export type ColumnKind = 'sidebar' | 'panel' | 'auxiliaryBar';

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';

export interface ColumnDef {
  id: string;
  /** Shown on the status-bar chip. */
  label: string;
  kind: ColumnKind;
  /**
   * Command run when revealing, used to choose *which* view appears —
   * e.g. `workbench.view.explorer` versus `workbench.view.scm`.
   */
  viewId?: string;
  /** For `panel` columns: which edge the panel occupies. */
  position?: PanelPosition;
}

export interface ColumnState {
  hidden: boolean;
}
