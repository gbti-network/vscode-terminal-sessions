import * as vscode from 'vscode';
import { ColumnDef } from '../columns/types';
import { getColumns } from '../columns/registry';
import { LayoutStore } from '../state/store';
import { hideColumn, resizeFocused, revealColumn } from '../content';

/**
 * Settings we override while enabled, snapshotted and restored on disable.
 *
 * `terminal.integrated.defaultLocation` matters more than it looks: without it,
 * Terminal > New Terminal can drop a shell into the editor area instead of the
 * terminal column, quietly working around the layout.
 */
const MANAGED_SETTINGS = [
  'terminal.integrated.defaultLocation',
  'workbench.panel.defaultLocation',
  'terminal.integrated.persistentSessionReviveProcess',
] as const;

/**
 * Write a managed setting at global scope.
 *
 * Deliberately not workspace scope: this is a way of working, not a property of
 * one repo, and workspace writes would leave a `.vscode/settings.json` diff in
 * every project. Global also sidesteps workspace scope throwing outright in a
 * window with no folder open.
 */
async function writeSetting(key: string, value: unknown): Promise<void> {
  try {
    await vscode.workspace
      .getConfiguration()
      .update(key, value, vscode.ConfigurationTarget.Global);
  } catch {
    // Nothing more we can do; visibility toggling still works.
  }
}

export class LayoutEngine implements vscode.Disposable {
  private readonly statusItems = new Map<string, vscode.StatusBarItem>();
  /** Visibility last actually pushed to VS Code, per column. */
  private readonly applied = new Map<string, boolean>();

  constructor(private readonly store: LayoutStore) {}

  // ---------------------------------------------------------------- lifecycle

  async enable(): Promise<void> {
    // Snapshot only on the transition, or we'd record our own overrides as the
    // values to restore. Applying happens every time, so a workspace already
    // marked enabled still picks up settings managed by a later version.
    if (!this.store.enabled) {
      await this.saveManagedSettings();
    }
    await this.applyManagedSettings();
    await this.store.setEnabled(true);
    await vscode.commands.executeCommand('setContext', 'terminalSessions.enabled', true);
    await this.apply();
  }

  async disable(): Promise<void> {
    this.disposeStatusItems();
    this.applied.clear();
    await this.restoreManagedSettings();
    await this.store.setEnabled(false);
    await vscode.commands.executeCommand('setContext', 'terminalSessions.enabled', false);
  }

  dispose(): void {
    this.disposeStatusItems();
  }

  /**
   * Put the chips up without touching the layout.
   *
   * Called on activation so the extension is visible and usable immediately,
   * without rearranging anyone's workbench until they ask for it.
   */
  init(): void {
    this.refreshStatusBar();
  }

  // ------------------------------------------------------------------ columns

  get columns(): ColumnDef[] {
    return getColumns();
  }

  find(id: string): ColumnDef | undefined {
    return this.columns.find((c) => c.id === id);
  }

  private isHidden(def: ColumnDef): boolean {
    return this.store.stateFor(def).hidden;
  }

  // -------------------------------------------------------------------- apply

  /**
   * Bring container visibility in line with stored state.
   *
   * Only acts on an actual change: revealing a container focuses it, so doing
   * this unconditionally would yank focus around every time any column moved.
   */
  async apply(): Promise<void> {
    for (const def of this.columns) {
      const hidden = this.isHidden(def);
      if (this.applied.get(def.id) !== hidden) {
        await (hidden ? hideColumn(def) : revealColumn(def));
        this.applied.set(def.id, hidden);
      }
    }
    this.refreshStatusBar();
  }

  /**
   * Re-assert every container, ignoring what we think is already applied.
   *
   * Used on startup, where VS Code has restored its own idea of which parts are
   * open and our cache says nothing yet.
   */
  async applyAll(): Promise<void> {
    this.applied.clear();
    await this.apply();
  }

  // ------------------------------------------------------------- show / hide

  async toggle(id: string): Promise<void> {
    const def = this.find(id);
    if (!def) {
      return;
    }
    // Toggling is how most people first reach for this, so treat it as an
    // implicit enable rather than doing something odd to an unmanaged layout.
    if (!this.store.enabled) {
      await this.enable();
    }
    await this.setHidden(id, !this.isHidden(def));
  }

  async show(id: string): Promise<void> {
    await this.setHidden(id, false);
  }

  async hide(id: string): Promise<void> {
    await this.setHidden(id, true);
  }

  private async setHidden(id: string, hidden: boolean): Promise<void> {
    await this.store.setHidden(id, hidden);
    await this.apply();
  }

  async hideAll(): Promise<void> {
    for (const def of this.columns) {
      await this.store.setHidden(def.id, true);
    }
    await this.apply();
  }

  async showAll(): Promise<void> {
    for (const def of this.columns) {
      await this.store.setHidden(def.id, false);
    }
    await this.apply();
  }

  async reset(): Promise<void> {
    await this.store.reset();
    await this.applyAll();
  }

  /** Open a shell in the terminal column, revealing it first if hidden. */
  async newTerminal(): Promise<void> {
    if (!this.store.enabled) {
      await this.enable();
    }
    const def = this.columns.find((c) => c.kind === 'panel');
    if (def && this.isHidden(def)) {
      await this.show(def.id);
    }
    await vscode.commands.executeCommand('workbench.action.terminal.new');
  }

  async grow(): Promise<void> {
    await resizeFocused(true);
  }

  async shrink(): Promise<void> {
    await resizeFocused(false);
  }

  // ------------------------------------------------------------------ status bar

  /**
   * A clickable chip per column — the control surface for this extension.
   *
   * Deliberately the only one. VS Code offers no contribution point for
   * double-clicking empty tab-bar space, no title-bar slot for the panel or
   * auxiliary bar, and no way to observe those containers being hidden by their
   * own buttons. The status bar is the one place a reliable, always-visible
   * indicator can live.
   */
  private refreshStatusBar(): void {
    // Shown even before the layout has been enabled — the chips *are* the
    // feature, so gating them on an enable step just hides the whole extension.
    // Only an explicit Disable takes them away.
    if (this.store.disabled) {
      this.disposeStatusItems();
      return;
    }

    const columns = this.columns;
    const wanted = new Set(columns.map((def) => def.id));

    for (const [id, item] of this.statusItems) {
      if (!wanted.has(id)) {
        item.dispose();
        this.statusItems.delete(id);
      }
    }

    columns.forEach((def, index) => {
      let item = this.statusItems.get(def.id);
      if (!item) {
        item = vscode.window.createStatusBarItem(
          `terminalSessions.column.${def.id}`,
          vscode.StatusBarAlignment.Left,
          100 - index,
        );
        item.name = `Terminal Sessions: ${def.label}`;
        this.statusItems.set(def.id, item);
      }
      const hidden = this.isHidden(def);
      item.text = `${hidden ? '$(eye-closed)' : '$(eye)'} ${def.label}`;
      item.tooltip = `${hidden ? 'Show' : 'Hide'} ${def.label}`;
      item.command = { command: 'terminalSessions.toggle', title: 'Toggle', arguments: [def.id] };
      item.show();
    });
  }

  private disposeStatusItems(): void {
    for (const item of this.statusItems.values()) {
      item.dispose();
    }
    this.statusItems.clear();
  }

  // -------------------------------------------------------- managed settings

  private async saveManagedSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const saved: Record<string, unknown> = {};
    for (const key of MANAGED_SETTINGS) {
      saved[key] = config.inspect(key)?.globalValue;
    }
    await this.store.setSavedSettings(saved);
  }

  private async applyManagedSettings(): Promise<void> {
    // Keep Terminal > New Terminal inside the terminal column's own view.
    await writeSetting('terminal.integrated.defaultLocation', 'view');
    const panel = this.columns.find((c) => c.kind === 'panel');
    if (panel) {
      await writeSetting('workbench.panel.defaultLocation', panel.position ?? 'right');
    }
    // Default is "onExit", which revives terminals only when the *application*
    // exits — closing a window (or stopping a debug session) loses them. This
    // widens it to window close, which is what makes "reopen and my terminals
    // are still here" true rather than aspirational.
    await writeSetting(
      'terminal.integrated.persistentSessionReviveProcess',
      'onExitAndWindowClose',
    );
  }

  private async restoreManagedSettings(): Promise<void> {
    for (const [key, value] of Object.entries(this.store.savedSettings ?? {})) {
      await writeSetting(key, value);
    }
    await this.store.setSavedSettings(undefined);
  }

  // ------------------------------------------------------------- diagnostics

  async probe(): Promise<string> {
    return [
      `VS Code ${vscode.version}`,
      `enabled: ${this.store.enabled}`,
      '',
      'columns:',
      ...this.columns.map((def) => {
        const state = this.store.stateFor(def);
        const applied = this.applied.get(def.id);
        return `  ${def.id} (${def.kind}${def.position ? ` ${def.position}` : ''}) hidden=${state.hidden} applied=${applied ?? '-'} viewId=${def.viewId ?? '-'}`;
      }),
      '',
      `editor groups: ${vscode.window.tabGroups.all.length}`,
      ...vscode.window.tabGroups.all.map(
        (group) => `  ViewColumn.${group.viewColumn} tabs=${group.tabs.length}`,
      ),
    ].join('\n');
  }
}
