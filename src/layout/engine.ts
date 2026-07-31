import * as vscode from 'vscode';
import { ColumnDef } from '../columns/types';
import { getColumns } from '../columns/registry';
import { LayoutStore } from '../state/store';
import {
  editorColumnSupported,
  hideColumn,
  resizeFocused,
  resolveEditorToggle,
  revealColumn,
} from '../content';

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
  'workbench.panel.opensMaximized',
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
  /**
   * Whether this host can hide the editor area. Resolved once in `init`,
   * because the check is async and `refreshStatusBar` is not.
   */
  private editorSupported = true;

  constructor(private readonly store: LayoutStore) {}

  // ---------------------------------------------------------------- lifecycle

  async enable(): Promise<void> {
    // Safe to call unconditionally: it backfills keys it has not recorded yet
    // and never overwrites an existing entry, so our own overrides are not
    // snapshotted as the values to restore. That is what lets a workspace
    // already marked enabled pick up a setting managed by a later version and
    // still have it restored on disable.
    await this.saveManagedSettings();
    await this.applyManagedSettings();
    await this.store.setLayoutEnabled(true);
    await vscode.commands.executeCommand('setContext', 'terminalSessions.layoutEnabled', true);
    await this.apply();
  }

  async disable(): Promise<void> {
    this.disposeStatusItems();
    this.applied.clear();
    await this.restoreManagedSettings();
    await this.store.setLayoutEnabled(false);
    await vscode.commands.executeCommand('setContext', 'terminalSessions.layoutEnabled', false);
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
  async init(): Promise<void> {
    this.editorSupported = await editorColumnSupported();
    this.refreshStatusBar();
  }

  // ------------------------------------------------------------------ columns

  /**
   * The configured columns, minus any this host cannot actually drive.
   *
   * A chip that does nothing is worse than no chip, so on a host without either
   * editor-toggle command the editor column is dropped entirely rather than
   * shown and silently ignored.
   */
  get columns(): ColumnDef[] {
    const columns = getColumns();
    return this.editorSupported ? columns : columns.filter((c) => c.kind !== 'editor');
  }

  /**
   * Apply order, which is load-bearing for the first time.
   *
   * Hiding the editor means maximizing the panel, and any later reveal or hide
   * of the panel column unwinds that. So the editor column goes last, after the
   * panel has settled. The sort is stable, so everything else keeps its
   * declared order — which the chips rely on for their status-bar priority.
   */
  private get applyOrder(): ColumnDef[] {
    return [...this.columns].sort(
      (a, b) => Number(a.kind === 'editor') - Number(b.kind === 'editor'),
    );
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
    for (const def of this.applyOrder) {
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
    if (!this.store.layoutEnabled) {
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

  /**
   * Columns currently visible. Read through `stateFor`, so ids not yet in the
   * store are seeded here as visible, which is what they will render as.
   */
  private visibleCount(): number {
    return this.columns.filter((def) => !this.isHidden(def)).length;
  }

  private async setHidden(id: string, hidden: boolean): Promise<void> {
    // The floor: something always stays open. Hiding the final column would
    // leave a window with nothing in it and no chip lit to get back from,
    // since the editor is now hideable too and can no longer be the fallback
    // the other three used to rely on. Refused silently — the chip not
    // changing says it, and `run` in content/ swallows failures the same way.
    if (hidden && this.visibleCount() <= 1) {
      return;
    }

    // The editor and panel columns are two ends of one lever, so hiding either
    // has to settle the other first. Both directions are read out of the
    // workbench source rather than guessed:
    //
    //   `toggleMaximizedPanel` maximizing  -> setEditorHidden(true) only. It
    //     never reveals a hidden panel, so hiding the editor while the panel is
    //     closed would leave neither on screen.
    //   `setPanelHidden` hiding a maximized panel -> `e && n &&
    //     toggleMaximizedPanel()`, whose other branch is setEditorHidden(false).
    //     So closing the terminal column brings the editor back by itself.
    const def = this.find(id);
    const panel = this.columns.find((c) => c.kind === 'panel');
    const editor = this.columns.find((c) => c.kind === 'editor');

    if (hidden && def?.kind === 'editor' && panel && this.isHidden(panel)) {
      // Route through the store rather than revealing behind its back, or the
      // terminal chip would claim hidden while its container is on screen.
      await this.store.setHidden(panel.id, false);
    }

    if (hidden && def?.kind === 'panel' && editor && this.isHidden(editor)) {
      // Follow VS Code rather than fight it: it is about to restore the editor,
      // so record that. `applied` is pre-seeded deliberately — without it the
      // pass below would see a change on the editor column and toggle a
      // container the workbench has already put right, hiding it straight back.
      //
      // This assumes the un-maximize actually fires. `isPanelMaximized` also
      // requires `!isAuxiliaryBarMaximized()`, so a maximized auxiliary bar
      // falls into the same drift the README documents for the other columns.
      await this.store.setHidden(editor.id, false);
      this.applied.set(editor.id, false);
    }

    await this.store.setHidden(id, hidden);
    await this.apply();
  }

  async reset(): Promise<void> {
    await this.store.reset();
    await this.applyAll();
  }

  /** Open a shell in the terminal column, revealing it first if hidden. */
  async newTerminal(): Promise<void> {
    if (!this.store.layoutEnabled) {
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
    if (this.store.layoutDisabled) {
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

  /**
   * Snapshot the settings we are about to override, so `disable` can put them
   * back.
   *
   * Merges rather than replaces. Applying happens on every enable, so a version
   * that manages a new setting will override it in a workspace that was already
   * enabled and never snapshotted it — and `disable` would then leave that
   * setting on our value permanently. Backfilling the missing keys closes that,
   * and existing entries must win, because by now the current value may well be
   * our own override rather than the user's.
   */
  private async saveManagedSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const saved: Record<string, unknown> = { ...(this.store.savedSettings ?? {}) };
    for (const key of MANAGED_SETTINGS) {
      if (!(key in saved)) {
        saved[key] = config.inspect(key)?.globalValue;
      }
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
    // Default is "preserve", which reopens the panel maximized if it was
    // maximized when last closed — and a maximized panel *is* a hidden editor.
    // That would hide the editor column with no chip click, from runtime state
    // no API can read. "never" makes the editor chip the only thing that moves
    // it, which is the whole point of having one.
    await writeSetting('workbench.panel.opensMaximized', 'never');
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
      `layout enabled: ${this.store.layoutEnabled}${this.store.layoutDisabled ? ' (explicitly disabled)' : ''}`,
      `editor toggle: ${(await resolveEditorToggle()) ?? 'unavailable — editor column dropped'}`,
      `panel position: ${vscode.workspace.getConfiguration().get('workbench.panel.defaultLocation') ?? '-'}`,
      `panel alignment: ${vscode.workspace.getConfiguration().get('workbench.panel.alignment') ?? '-'}`,
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
