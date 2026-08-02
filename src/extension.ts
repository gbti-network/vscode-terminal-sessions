import * as vscode from 'vscode';
import { LayoutEngine } from './layout/engine';
import { LayoutStore } from './state/store';
import { getColumns } from './columns/registry';
import { SessionRecorder } from './session/recorder';
import { SessionRestorer } from './session/restore';
import { draftFromTerminal, pickProfile } from './profiles/author';
import { launchProfile, markHandled, replayCommands, wasHandled } from './profiles/launcher';
import { ProfileMirror } from './profiles/mirror';
import { registerSavedSessionProfile } from './profiles/provider';
import { deleteProfile, getProfiles } from './profiles/registry';
import { migrateCommand } from './profiles/migrate';
import { ProfileItem, ProfileTreeProvider } from './profiles/tree';
import { ProfileManager } from './profiles/manager';
import { listWslDistros } from './profiles/wsl';
import { InstanceProfile } from './profiles/types';

let engine: LayoutEngine | undefined;
let recorder: SessionRecorder | undefined;
let restorer: SessionRestorer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new LayoutStore(context);
  engine = new LayoutEngine(store);
  context.subscriptions.push(engine);

  recorder = new SessionRecorder();
  context.subscriptions.push(recorder);

  restorer = new SessionRestorer(context);
  context.subscriptions.push(restorer);

  const register = (command: string, handler: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register('terminalSessions.layout.enable', () => engine?.enable());
  register('terminalSessions.layout.disable', () => engine?.disable());
  register('terminalSessions.growColumn', () => engine?.grow());
  register('terminalSessions.shrinkColumn', () => engine?.shrink());
  register('terminalSessions.resetLayout', () => engine?.reset());
  register('terminalSessions.newTerminal', () => engine?.newTerminal());
  register('terminalSessions.dumpSession', () => recorder?.dump());

  // ---- instance profiles ----

  /**
   * Profiles we have asked VS Code to open a terminal for, and not yet seen.
   *
   * The contributed `+` dropdown entry returns *options*; VS Code creates the
   * terminal, so the only way to replay into it is to watch for it appearing.
   * This records that we asked. Without it the watcher had nothing to go on but
   * the terminal's name, which matched three things it should not have: a
   * terminal VS Code revived with a live process still in it, a terminal the
   * user opened by hand that happens to be called `bash`, and the contributed
   * terminal itself twice, because a second listener was registered per request
   * and neither knew about the other.
   *
   * Entries expire because a request that is cancelled never produces a
   * terminal, and a name left pending forever would replay into whatever opened
   * with that name next.
   */
  const requested = new Map<string, number>();
  const REQUEST_TTL_MS = 60_000;

  const claimRequest = (name: string): boolean => {
    const at = requested.get(name);
    requested.delete(name);
    return at !== undefined && Date.now() - at < REQUEST_TTL_MS;
  };

  context.subscriptions.push(
    registerSavedSessionProfile((name) => {
      requested.set(name, Date.now());
    }),
  );

  // Launching from the manager goes through the same path as anywhere else, so
  // the profile is tracked and comes back after a restart.
  const launchAndTrack = async (profile: InstanceProfile) => {
    const terminal = await launchProfile(profile);
    await restorer?.track(profile, terminal);
  };

  const mirror = new ProfileMirror(context.globalState);

  // The single replay path for terminals VS Code creates on our behalf.
  //
  // Gated on having asked for this terminal, not on its name. A name match alone
  // typed a profile's commands into any shell that happened to share the name,
  // including one VS Code revived with the user's own process still running in
  // it, which is exactly the case `SessionRestorer` goes to the trouble of
  // detecting by pid and deliberately leaving alone.
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(async (terminal) => {
      if (wasHandled(terminal) || !claimRequest(terminal.name)) {
        return;
      }
      const profile = getProfiles().find((p) => p.name === terminal.name);
      if (!profile) {
        return;
      }
      markHandled(terminal);
      await restorer?.track(profile, terminal);
      if (profile.commands.length) {
        await replayCommands(terminal, profile.commands);
      }
    }),
  );

  /**
   * Bind a saved profile to the terminal it describes.
   *
   * Saving a profile from an existing terminal used to leave that terminal
   * unassociated, so the session was never restored — only profiles *launched*
   * through the extension were tracked. Matching by name on save closes that
   * gap, and records the pid so restore can tell a survivor from a revived tab.
   */
  const associateWithTerminal = async (profile: InstanceProfile) => {
    const terminal = vscode.window.terminals.find((t) => t.name === profile.name);
    if (terminal) {
      markHandled(terminal);
      await restorer?.track(profile, terminal);
    }
  };

  const openManager = (draft?: Partial<InstanceProfile>) =>
    ProfileManager.show(
      context.extensionUri,
      mirror,
      (profile) => void launchAndTrack(profile),
      (profile) => void associateWithTerminal(profile),
      draft,
    );

  register('terminalSessions.manageInstanceProfiles', () => openManager());

  // ---- sidebar view ----

  const tree = new ProfileTreeProvider();
  context.subscriptions.push(tree);

  // createTreeView rather than registerTreeDataProvider: it exposes `visible`,
  // which is what lets the editor drop its own profile list when the sidebar is
  // already showing one. Two lists side by side is redundant and squeezes the
  // form into an unusable width.
  //
  // Guarded because it throws "No view is registered" when something else has
  // claimed the id, which happens when a second copy of this extension is
  // installed: an orphaned folder left behind by a rename still gets scanned,
  // and only one copy can own the view. Unguarded, that error aborts the rest
  // of activate and takes the chips and every command down with it, which is a
  // far worse failure than a missing sidebar.
  let treeView: vscode.TreeView<ProfileItem> | undefined;
  try {
    treeView = vscode.window.createTreeView('terminalSessions.profiles', {
      treeDataProvider: tree,
    });
  } catch {
    void vscode.window.showWarningMessage(
      'Terminal Sessions: the Session Profiles view could not be registered, usually because a second copy of this extension is installed. Everything else still works, and profiles are available from the command palette.',
    );
  }

  if (treeView) {
    const view = treeView;
    context.subscriptions.push(view);
    const syncManagerChrome = () => ProfileManager.setListVisible(!view.visible);
    context.subscriptions.push(view.onDidChangeVisibility(syncManagerChrome));
    syncManagerChrome();
  } else {
    // No sidebar list, so the editor keeps its own.
    ProfileManager.setListVisible(true);
  }

  register('terminalSessions.profiles.new', async () => {
    await openManager().newDraft();
  });
  register('terminalSessions.profiles.refresh', () => tree.refresh());

  /**
   * Put the Session Profiles view back when its icon has gone missing.
   *
   * VS Code persists which container a view lives in, and moves an orphaned
   * view to a default container when its own container id stops existing. A
   * container left with no views is then hidden, so the activity bar icon
   * disappears with it. There is no API to read or set a view's location, so
   * recovery has to go through VS Code's own commands.
   *
   * `<viewId>.focus` is generated for every contributed view and reveals it
   * wherever it currently is, which is enough when it has merely been moved.
   * Resetting locations is the fallback, and is offered rather than done,
   * because it moves every view in the window and not just this one.
   */
  register('terminalSessions.profiles.reveal', async () => {
    try {
      await vscode.commands.executeCommand('terminalSessions.profiles.focus');
      return;
    } catch {
      // Fall through to the reset offer.
    }
    const choice = await vscode.window.showWarningMessage(
      'The Session Profiles view could not be revealed. Resetting view locations puts every view back in its own container, including this one.',
      'Reset View Locations',
    );
    if (choice) {
      await vscode.commands.executeCommand('workbench.action.resetViewLocations');
    }
  });
  register('terminalSessions.profiles.moveToWorkspace', () => migrateCommand(context));

  register('terminalSessions.profiles.edit', async (item?: ProfileItem) => {
    const manager = openManager();
    if (item?.profile) {
      await manager.reveal(item.profile.name);
    }
  });

  register('terminalSessions.profiles.launch', async (item?: ProfileItem) => {
    const profile = item?.profile ?? (await pickProfile());
    if (profile) {
      await launchAndTrack(profile);
    }
  });

  register('terminalSessions.profiles.delete', async (item?: ProfileItem) => {
    const profile = item?.profile ?? (await pickProfile('Delete which saved profile?'));
    if (!profile) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete instance profile "${profile.name}"?`,
      { modal: true },
      'Delete',
    );
    if (confirm === 'Delete') {
      await deleteProfile(profile.name);
      await mirror.remove(profile.name);
      tree.refresh();
    }
  });

  register('terminalSessions.saveInstanceProfile', async () => {
    // Opens the manager pre-seeded from the terminal rather than running a
    // chain of input boxes: a profile is several related fields plus an ordered
    // list, which modal prompts cannot show or let you revise.
    const distros = await listWslDistros();
    openManager(draftFromTerminal(vscode.window.activeTerminal, distros));
  });

  register('terminalSessions.launchInstanceProfile', async (name?: string) => {
    const profile = typeof name === 'string'
      ? getProfiles().find((p) => p.name === name)
      : await pickProfile();
    if (profile) {
      await launchAndTrack(profile);
    }
  });

  register('terminalSessions.restoreSession', async () => {
    const result = await restorer?.restore();
    if (!result) {
      return;
    }
    const parts: string[] = [];
    if (result.relaunched.length) {
      parts.push(`reopened ${result.relaunched.join(', ')}`);
    }
    if (result.kept.length) {
      parts.push(`${result.kept.join(', ')} still running`);
    }
    if (result.missing.length) {
      parts.push(`no profile for ${result.missing.join(', ')}`);
    }
    void vscode.window.showInformationMessage(
      parts.length ? `Session restore: ${parts.join('; ')}.` : 'Nothing to restore.',
    );
  });

  register('terminalSessions.forgetSession', async () => {
    const profile = await pickProfile('Stop restoring which profile?');
    if (profile) {
      await restorer?.forget(profile.name);
    }
  });


  register('terminalSessions.toggle', async (id?: string) => {
    if (typeof id === 'string') {
      await engine?.toggle(id);
      return;
    }
    await pickColumnToToggle();
  });

  // Declared in package.json and bound to keys, so these must always exist even
  // when the default column set has been replaced. A missing column is a no-op.
  for (const id of ['files', 'editor', 'terminal', 'chat']) {
    register(`terminalSessions.toggle.${id}`, () => engine?.toggle(id));
  }

  register('terminalSessions.probeLayout', async () => {
    const report = await engine?.probe();
    if (!report) {
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      content: report,
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (store.layoutEnabled && event.affectsConfiguration('terminalSessions.columns')) {
        await engine?.applyAll();
      }
    }),
  );

  await vscode.commands.executeCommand(
    'setContext',
    'terminalSessions.layoutEnabled',
    store.layoutEnabled,
  );

  // Chips go up straight away, so the extension is discoverable and usable
  // without a hidden enable step. Clicking one enables the layout implicitly.
  // Awaited because it first resolves whether this host can hide the editor
  // area, which decides whether that chip exists at all.
  await engine.init();

  const config = vscode.workspace.getConfiguration('terminalSessions');
  const autoEnable = layoutSetting(config, 'autoEnable', true);
  const everywhere = layoutSetting(config, 'autoEnableEverywhere', true);

  // An explicit Disable outranks the blanket `autoEnableEverywhere`. The stored
  // flag is tri-state precisely so "never decided" and "turned off on purpose"
  // can be told apart, and this is the place that has to honour the difference:
  // without it, Disable lasted only until the window reloaded.
  if (!store.layoutDisabled && (everywhere || (store.layoutEnabled && autoEnable))) {
    // Let VS Code finish restoring its own layout first, then assert ours over
    // whatever came back. `enable` is safe when already enabled — it only
    // writes the managed settings on the transition.
    setTimeout(() => void engine?.enable(), 1200);
  }

  if (config.get<boolean>('autoRestoreSession', true)) {
    // Wait for VS Code's own terminal revival to finish, otherwise the revived
    // tabs appear *after* the restore pass and we would end up with duplicates.
    const delay = config.get<number>('restoreDelayMs', 3000);
    setTimeout(() => {
      void vscode.commands.executeCommand('terminalSessions.restoreSession');
    }, delay);
  }
}

/**
 * Read a layout setting, falling back to its pre-rename key.
 *
 * `autoEnable` and `autoEnableEverywhere` moved under `layout.` once the column
 * layout became the only half of this extension with a switch. Anyone who set
 * the old key should not silently lose it, so an explicit value there still
 * wins over the new key's default — and only over its *default*, which is why
 * this inspects rather than calling `get`.
 */
function layoutSetting(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: boolean,
): boolean {
  const explicit = (name: string): boolean | undefined => {
    const values = config.inspect<boolean>(name);
    return (
      values?.workspaceFolderValue ?? values?.workspaceValue ?? values?.globalValue
    );
  };
  return explicit(`layout.${key}`) ?? explicit(key) ?? fallback;
}

async function pickColumnToToggle(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    getColumns().map((def) => ({
      label: def.label,
      description: def.kind,
      id: def.id,
    })),
    { placeHolder: 'Show or hide which column?' },
  );
  if (picked) {
    await engine?.toggle(picked.id);
  }
}

export function deactivate(): void {
  engine?.dispose();
  engine = undefined;
  recorder?.dispose();
  recorder = undefined;
  restorer?.dispose();
  restorer = undefined;
}
