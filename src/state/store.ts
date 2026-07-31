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
  /** Settings we overrode on enable, so `disable` can put them back. */
  savedSettings?: Record<string, unknown>;
}

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

  get savedSettings(): Record<string, unknown> | undefined {
    return this.data.savedSettings;
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

  async setSavedSettings(settings: Record<string, unknown> | undefined): Promise<void> {
    this.data.savedSettings = settings;
    await this.flush();
  }

  /** Drop visibility state, keeping the enabled flag. */
  async reset(): Promise<void> {
    const { enabled, savedSettings } = this.data;
    this.data = { ...empty(), enabled, savedSettings };
    await this.flush();
  }

  private flush(): Thenable<void> {
    return this.context.workspaceState.update(KEY, this.data);
  }
}
