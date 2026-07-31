import * as vscode from 'vscode';
import { InstanceProfile, describeProfile } from './types';
import { getProfiles } from './registry';

/**
 * The profile list, as a sidebar view.
 *
 * A tree rather than a webview: the sidebar is too narrow for the editor form,
 * and a tree gets native styling, keyboard navigation and inline actions for
 * free. Clicking a profile opens the full editor in an editor tab; the inline
 * play button launches it without leaving the sidebar.
 */
export class ProfileTreeProvider
  implements vscode.TreeDataProvider<ProfileItem>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<ProfileItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('terminalSessions.instanceProfiles')) {
          this.refresh();
        }
      }),
    );
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: ProfileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ProfileItem[] {
    return getProfiles().map((profile) => new ProfileItem(profile));
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.emitter.dispose();
  }
}

export class ProfileItem extends vscode.TreeItem {
  constructor(readonly profile: InstanceProfile) {
    super(profile.name, vscode.TreeItemCollapsibleState.None);
    this.description = describeProfile(profile);
    this.tooltip = new vscode.MarkdownString(
      [
        `**${profile.name}**`,
        '',
        `- Shell: ${profile.distro ? `${profile.distro} (WSL)` : (profile.shellPath ?? 'host default')}`,
        `- Directory: ${profile.cwd ?? '(inherited)'}`,
        `- In terminal dropdown: ${profile.showInDropdown ? 'yes' : 'no'}`,
        '',
        profile.commands.length
          ? profile.commands.map((c, i) => `${i + 1}. \`${c}\``).join('\n')
          : '_No commands._',
      ].join('\n'),
    );
    this.iconPath = new vscode.ThemeIcon(profile.distro ? 'server' : 'terminal');
    this.contextValue = 'terminalSessionProfile';
    // Click edits rather than launches: launching spawns processes, which is
    // too consequential for a single click. The inline play button does that.
    this.command = {
      command: 'terminalSessions.profiles.edit',
      title: 'Edit Profile',
      arguments: [this],
    };
  }
}
