# Terminal Session Profiles

[![VS Marketplace](https://vsmarketplacebadges.dev/version-short/GBTI.gbti-terminal-sessions.svg)](https://marketplace.visualstudio.com/items?itemName=GBTI.gbti-terminal-sessions)
[![Installs](https://vsmarketplacebadges.dev/installs-short/GBTI.gbti-terminal-sessions.svg)](https://marketplace.visualstudio.com/items?itemName=GBTI.gbti-terminal-sessions)
[![License](https://img.shields.io/badge/license-MIT-4ee39a)](LICENSE)

Save a terminal as a reusable **session profile** (which shell to open, where, and what to run once it is ready), then bring it back with one click after a restart. Also repositions the Explorer, terminal and chat panes as collapsible columns.

[![Terminal Session Profiles: save terminals as profiles, restore and reprovision on restart](.product/public/demo-thumbnail.jpg)](https://youtu.be/eaAsh42seho)

**[Watch the two minute demo on YouTube](https://youtu.be/eaAsh42seho).**

**[Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=GBTI.gbti-terminal-sessions)**, or from Quick Open inside VS Code (`Ctrl+P`):

```
ext install GBTI.gbti-terminal-sessions
```

![Every profile one click away: the Session Profiles view, with a profile launching claude --resume ClaudeCodeWorker1 in the terminal column](.product/public/01-profiles.png)

## Built on VS Code's native terminal support

VS Code already supports [persistent terminal sessions](https://code.visualstudio.com/docs/terminal/advanced), but its native features are spread across terminal profiles, tasks, settings, and workspace permissions.

Terminal Session Profiles brings those pieces into one UI and adds reusable workspace or global profiles, ordered startup commands, automatic reprovisioning, and optional Claude session resume commands.

VS Code remembers what was open. This extension remembers what should be opened.

## Session profiles

A profile is a saved terminal setup: which shell to open, where, and what to run once it is ready. Create one from the sidebar's **＋**, or right-click any terminal and choose **Save as Instance Profile** to start from a terminal you already have open.

- **Sidebar.** Every profile, with an inline ▶ to launch and ✎ to edit. Clicking a profile edits it rather than launching, because spawning processes is too consequential for a single click.
- **Editor.** All fields at once: name, shell, directory, and an ordered command list you can reorder and delete inline.
- **Terminal `+` dropdown.** Tick *Show in the terminal `+` dropdown* and the profile is mirrored into `terminal.integrated.profiles`, appearing there by name. Commands still run, because the extension replays them whenever a terminal opens with a matching name.

Saved profiles come back on their own after a restart, in the right shell with their commands replayed. Automatic by default, governed by `terminalSessions.autoRestoreSession`.

## Workspace and global profiles

Profiles are saved to the current workspace by default, inside `.vscode/settings.json`. You can instead save a profile globally so it follows you between projects.

Use the **Saved in** control to move a profile between scopes. The sidebar shows both workspace and global profiles, with global profiles clearly marked.

- A workspace profile overrides a global profile with the same name.
- Profiles added to the terminal `+` menu retain their original scope.
- To move several profiles at once, run **Move Global Profiles into This Workspace**.
- `terminalSessions.profileScope` only controls where new profiles begin.

## How commands run

Commands run in order after shell integration is ready. Each command must finish before the next begins, while the final command may remain active.

For example, place `claude --resume ClaudeCodeWorker1` last to reopen a specific Claude Code session, or use `claude --continue` to resume the most recent session in that directory.

![Every field at once: the profile editor with name, shell, working directory and an ordered command list](.product/public/02-editor.png)

## Column layout

Show or hide the Explorer, editor, terminal, and chat from status-bar controls. The layout is remembered per workspace and uses VS Code's native panes, preserving terminal lists and Claude or Codex chat.

One column always remains visible so the workspace cannot be left empty.

![Four columns, one keystroke each: Explorer, editor, terminal and chat with their status bar chips](.product/public/03-columns.png)

## Commands

Open the palette with `Ctrl+Shift+P` and type `Terminal Sessions` to see all of them.

| Command, as it appears in the palette | Default key |
|---|---|
| Terminal Sessions: Manage Instance Profiles | none |
| Terminal Sessions: New Instance Profile | none |
| Terminal Sessions: Save as Instance Profile | terminal right-click |
| Terminal Sessions: Move Global Profiles into This Workspace | none |
| Terminal Sessions: Show Session Profiles View | none |
| Terminal Sessions: Restore Last Session | none |
| Terminal Sessions: Stop Restoring a Profile... | none |
| Terminal Sessions: Toggle Files Column | `Ctrl+Alt+1` |
| Terminal Sessions: Toggle Editor Column | `Ctrl+Alt+2` |
| Terminal Sessions: Toggle Terminal Column | `Ctrl+Alt+3` |
| Terminal Sessions: Toggle Chat Column | `Ctrl+Alt+4` |
| Terminal Sessions: Show or Hide Column... | none |
| Terminal Sessions: Enable Column Layout | none |
| Terminal Sessions: Disable Column Layout | none |
| Terminal Sessions: New Terminal in Column | ``Ctrl+Shift+` `` |
| Terminal Sessions: Grow Focused Column | `Ctrl+Alt+Right` |
| Terminal Sessions: Shrink Focused Column | `Ctrl+Alt+Left` |
| Terminal Sessions: Reset Layout | none |

## Settings

| Setting | Default | |
|---|---|---|
| `terminalSessions.profileScope` | `workspace` | Where a new profile is saved: this project, or global. |
| `terminalSessions.instanceProfiles` | `[]` | Saved terminal setups. Hand-editable, at either scope. |
| `terminalSessions.autoRestoreSession` | `true` | Reopen saved profiles on startup. |
| `terminalSessions.restoreDelayMs` | `3000` | Wait for VS Code's own revival first, so tabs aren't duplicated. |
| `terminalSessions.layout.autoEnableEverywhere` | `true` | Bring the column layout up in every workspace. |
| `terminalSessions.layout.autoEnable` | `true` | Bring it back on startup where it was already on. |
| `terminalSessions.columns` | built-in | Which containers the chips control. |

## License

MIT, copyright Gethsemane LLC. See [LICENSE](LICENSE).
