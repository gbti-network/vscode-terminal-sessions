import * as vscode from 'vscode';
import { ColumnDef, ColumnState } from '../columns/types';

/**
 * v2. v1 stored rail widths and a calibrated editor-area size for the
 * editor-group approach that has since been removed; that data is ignored.
 */
const KEY = 'terminalSessions.layout.v2';
/**
 * Pre-rename key. Read as a fallback so the snapshot of managed settings
 * survives — without it, `disable` would no longer restore the terminal and
 * panel settings this extension overrode.
 */
const LEGACY_KEY = 'kanban.layout.v2';

interface PersistedLayout {
  version: 2;
  /**
   * Whether the *column layout* is on. Nothing to do with session profiles or
   * restore, which run regardless — the two halves of this extension are
   * independent, and only this one has a switch.
   *
   * Tri-state on purpose. `undefined` means never decided — chips should show
   * so the feature is discoverable — whereas `false` means the user explicitly
   * turned it off and we should stay out of the way. The field keeps its
   * original name so existing workspace state still reads.
   */
  enabled?: boolean;
  columns: Record<string, ColumnState>;
}

/**
 * Where the snapshot of overridden settings lives.
 *
 * Global, not per workspace, because the settings it protects are written at
 * global scope. It used to sit alongside the per-workspace column state, so
 * enabling the layout in a second folder found no snapshot there and captured
 * the *first* folder's overrides as the user's baseline. One process-wide
 * override cannot be tracked by N per-folder records.
 */
const SETTINGS_KEY = 'terminalSessions.managedSettings.v1';

function empty(): PersistedLayout {
  return { version: 2, columns: {} };
}

/**
 * Visibility state, persisted per workspace — a different project wants a
 * different set of panes open. Container *widths* are not stored here: VS Code
 * already persists those itself, including drags this extension cannot see.
 */
export class LayoutStore {
  private data: PersistedLayout;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored =
      context.workspaceState.get<PersistedLayout>(KEY) ??
      context.workspaceState.get<PersistedLayout>(LEGACY_KEY);
    this.data = stored && stored.version === 2 ? stored : empty();
  }

  /** True only once the column layout has actually been enabled. */
  get layoutEnabled(): boolean {
    return this.data.enabled === true;
  }

  /** True only if the user explicitly turned the column layout off. */
  get layoutDisabled(): boolean {
    return this.data.enabled === false;
  }

  /**
   * The snapshot taken when the layout was enabled, in whatever shape it was
   * written. `readSnapshot` upgrades the pre-0.5.0 flat record.
   */
  get savedSettings(): unknown {
    return (
      this.context.globalState.get<unknown>(SETTINGS_KEY) ??
      // Pre-0.5.0 snapshots were stored per workspace. Read one here so an
      // upgrade in a workspace that already had the layout on can still restore
      // the values it captured, rather than losing them at the version boundary.
      (this.context.workspaceState.get<{ savedSettings?: unknown }>(KEY)?.savedSettings ??
        this.context.workspaceState.get<{ savedSettings?: unknown }>(LEGACY_KEY)?.savedSettings)
    );
  }

  /** State for a column, seeded visible on first use. */
  stateFor(def: ColumnDef): ColumnState {
    const existing = this.data.columns[def.id];
    if (existing) {
      return existing;
    }
    const seeded: ColumnState = { hidden: false };
    this.data.columns[def.id] = seeded;
    return seeded;
  }

  async setLayoutEnabled(enabled: boolean): Promise<void> {
    this.data.enabled = enabled;
    await this.flush();
  }

  async setHidden(id: string, hidden: boolean): Promise<void> {
    const current = this.data.columns[id];
    if (current) {
      current.hidden = hidden;
      await this.flush();
    }
  }

  async setSavedSettings(settings: unknown): Promise<void> {
    await this.context.globalState.update(SETTINGS_KEY, settings);
  }

  /** Drop visibility state, keeping the enabled flag. */
  async reset(): Promise<void> {
    const { enabled } = this.data;
    this.data = { ...empty(), enabled };
    await this.flush();
  }

  private flush(): Thenable<void> {
    return this.context.workspaceState.update(KEY, this.data);
  }
}
