import * as vscode from 'vscode';
import { InstanceProfile, isValidProfile } from './types';
import { deleteProfile, getProfiles, hasWorkspace, profileScope, saveProfile, scopeOf } from './registry';
import { listWslDistros } from './wsl';
import { ProfileMirror } from './mirror';
import { defaultDraft } from './author';

/**
 * A real editor for instance profiles.
 *
 * Replaces a chain of input boxes, which was the wrong shape for this: a
 * profile is several related fields plus an ordered list, and a sequence of
 * modal prompts gives no way to see what you have entered, go back, reorder
 * commands, or edit an existing profile. It also made Escape ambiguous — VS
 * Code appends its own "Escape to cancel" hint that cannot be suppressed, so
 * pressing it mid-sequence silently discarded everything.
 */
export class ProfileManager {
  private static current: ProfileManager | undefined;
  /**
   * Whether the editor should draw its own profile list.
   *
   * Static because it tracks the sidebar view's visibility, which changes
   * whether or not the editor happens to be open — a panel opened later still
   * needs to come up in the right shape.
   */
  private static listVisible = true;

  /** Called when the sidebar view appears or disappears. */
  static setListVisible(visible: boolean): void {
    ProfileManager.listVisible = visible;
    ProfileManager.current?.postChrome();
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /**
   * A draft posted before the webview finished loading.
   *
   * Messages sent to a webview that has not yet run its script are dropped, so
   * a draft posted at creation time never arrives — the view would then ask for
   * a default and silently replace it. Holding it until `ready` fixes that.
   */
  private pendingDraft?: Partial<InstanceProfile>;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly mirror: ProfileMirror,
    private readonly onLaunch: (profile: InstanceProfile) => void,
    private readonly onSaved: (profile: InstanceProfile) => void,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'terminalSessions.profileManager',
      'Instance Profiles',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    this.panel.webview.html = this.render();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message) => void this.handle(message)),
      this.panel.onDidDispose(() => this.dispose()),
    );

    void this.refresh();
  }

  static show(
    extensionUri: vscode.Uri,
    mirror: ProfileMirror,
    onLaunch: (profile: InstanceProfile) => void,
    onSaved: (profile: InstanceProfile) => void,
    draft?: Partial<InstanceProfile>,
  ): ProfileManager {
    if (!ProfileManager.current) {
      ProfileManager.current = new ProfileManager(extensionUri, mirror, onLaunch, onSaved);
    }
    ProfileManager.current.panel.reveal();
    if (draft) {
      void ProfileManager.current.postDraft(draft);
    }
    return ProfileManager.current;
  }

  /** Show a fresh profile form with name, shell and directory guessed. */
  async newDraft(): Promise<void> {
    this.panel.reveal();
    await this.postDraft(await this.buildDefaultDraft());
  }

  /** Bring the panel forward with a specific profile loaded. */
  async reveal(name: string): Promise<void> {
    this.panel.reveal();
    await this.refresh(name);
  }

  /** Push the saved profiles and the real distro list into the view. */
  private async refresh(select?: string): Promise<void> {
    const distros = await listWslDistros();
    void this.panel.webview.postMessage({
      type: 'state',
      profiles: getProfiles(),
      distros,
      select,
      ...ProfileManager.scopeInfo(),
    });
  }

  /**
   * Where each profile lives, plus whether workspace scope is even available.
   *
   * Sent with every state push so the editor's scope control reflects reality
   * rather than guessing from the default.
   */
  private static scopeInfo() {
    const scopes: Record<string, string> = {};
    for (const profile of getProfiles()) {
      scopes[profile.name] = scopeOf(profile.name) ?? 'workspace';
    }
    return { scopes, canScopeToWorkspace: hasWorkspace(), defaultScope: profileScope() };
  }

  private postChrome(): void {
    void this.panel.webview.postMessage({
      type: 'chrome',
      showList: ProfileManager.listVisible,
    });
  }

  /** Name, shell and directory guessed from the workspace and installed distros. */
  async buildDefaultDraft(): Promise<Partial<InstanceProfile>> {
    const distros = await listWslDistros();
    return defaultDraft(
      distros,
      getProfiles().map((p) => p.name),
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    );
  }

  private async postDraft(draft: Partial<InstanceProfile>): Promise<void> {
    // Retained in case the view is not listening yet; `ready` replays it.
    this.pendingDraft = draft;
    const distros = await listWslDistros();
    void this.panel.webview.postMessage({
      type: 'state',
      profiles: getProfiles(),
      distros,
      draft,
      ...ProfileManager.scopeInfo(),
    });
  }

  private async handle(message: any): Promise<void> {
    switch (message?.type) {
      case 'save': {
        const profile = message.profile;
        if (!isValidProfile(profile)) {
          void vscode.window.showErrorMessage('A profile needs a name and at least one command.');
          return;
        }
        // Wrapped because a settings write can fail, and an unhandled rejection
        // here means the button appears to do nothing at all: no profile, no
        // error, no clue. Saying why is the minimum.
        try {
          // Renaming means the old entry has to go, or both would linger.
          if (message.originalName && message.originalName !== profile.name) {
            await deleteProfile(message.originalName);
          }
          await saveProfile(profile, message.scope === 'global' ? 'global' : 'workspace');
          await this.mirror.sync(profile, message.originalName);
          this.onSaved(profile);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Could not save "${profile.name}": ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        await this.refresh(profile.name);
        return;
      }
      case 'delete': {
        const confirm = await vscode.window.showWarningMessage(
          `Delete instance profile "${message.name}"?`,
          { modal: true },
          'Delete',
        );
        if (confirm === 'Delete') {
          await deleteProfile(message.name);
          await this.mirror.remove(message.name);
          await this.refresh();
        }
        return;
      }
      case 'launch': {
        const profile = getProfiles().find((p) => p.name === message.name);
        if (profile) {
          this.onLaunch(profile);
        }
        return;
      }
      case 'newDraft':
        await this.postDraft(await this.buildDefaultDraft());
        return;
      case 'ready': {
        this.postChrome();
        const pending = this.pendingDraft;
        this.pendingDraft = undefined;
        if (pending) {
          await this.postDraft(pending);
        } else {
          await this.refresh();
        }
        return;
      }
    }
  }

  private render(): string {
    const webview = this.panel.webview;
    const nonce = createNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'manager.css'),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'manager.js'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>Instance Profiles</title>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-head">
      <h2>Profiles</h2>
      <button id="new" class="ghost" title="New profile">＋</button>
    </div>
    <ul id="list" class="list"></ul>
    <p id="empty" class="empty">No profiles yet. Press ＋ to create one.</p>
  </aside>

  <main class="editor">
    <form id="form" autocomplete="off">
      <label for="name">Name</label>
      <input id="name" type="text" placeholder="my-project" required>
      <p class="hint">Also becomes the terminal tab name.</p>

      <label for="distro">Shell</label>
      <select id="distro"></select>
      <p class="hint">WSL distros are read from your machine. Pick the one your tools are installed in.</p>

      <label for="cwd">Working directory</label>
      <input id="cwd" type="text" placeholder="/mnt/d/projects/example">
      <p class="hint" id="cwd-hint">Linux path when a distro is selected.</p>

      <label for="scope">Saved in</label>
      <select id="scope">
        <option value="workspace">This project only</option>
        <option value="global">Every project (global)</option>
      </select>
      <p class="hint" id="scope-hint">
        A profile usually names one project's directory and runs its commands, so this project is
        the default. Change it here to move the profile; saving writes it to the new place and
        removes it from the old.
      </p>

      <label class="check">
        <input id="dropdown" type="checkbox">
        Show in the terminal <code>+</code> dropdown
      </label>
      <p class="hint">
        Mirrors the shell into <code>terminal.integrated.profiles</code> so it appears by name in
        VS Code's own menu. The native format has no field for commands, so those stay here and are
        replayed when the terminal opens.
      </p>

      <label>Commands</label>
      <div class="commands-head">
        <span class="index">#</span>
        <span class="col-run">Command</span>
        <span class="col-wait">Wait (ms)</span>
        <span class="col-actions"></span>
      </div>
      <ol id="commands" class="commands"></ol>
      <button type="button" id="add-command" class="ghost wide">＋ Add command</button>
      <p class="hint">
        Run in order once the shell is ready. Every command but the last is awaited, so a
        long-running process such as <code>claude</code> belongs last. Stored and replayed literally.
        <br>
        <strong>Wait</strong> is how long to allow before each command: on the first it is how long
        shell integration is given to activate (the slow part on a cold WSL bash); on later ones it
        caps how long the previous command may take. Default 3000.
      </p>

      <div class="actions">
        <button type="submit" id="save" class="primary">Save</button>
        <button type="button" id="launch">Open</button>
        <button type="button" id="delete" class="danger">Delete</button>
      </div>
    </form>
  </main>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    ProfileManager.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
