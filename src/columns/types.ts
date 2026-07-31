/**
 * The workbench containers that can be shown and hidden.
 *
 * The first three are independent of one another. `editor` is not, and the
 * asymmetry is worth stating: VS Code hides the editor area by *maximizing the
 * panel* over it — `workbench.action.toggleEditorVisibility` is a one-line
 * delegation to `toggleMaximizedPanel()`. So the editor's space is not
 * reclaimed by nothing, it is handed to the panel column, and the two can never
 * be hidden at the same time.
 *
 * An earlier attempt to control the editor area by manipulating editor groups
 * was tried and removed (see the v1 note in `state/store.ts`). This is the
 * supported lever, and the only one.
 */
export type ColumnKind = 'sidebar' | 'panel' | 'auxiliaryBar' | 'editor';

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
