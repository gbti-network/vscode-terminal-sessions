# Terminal Sessions

Save a terminal as a reusable **session profile** — which shell to open, where, and what to run once it is ready — then bring it back with one click after a restart. Also repositions the Explorer, terminal and chat panes as collapsible columns.

```
┌──────────────────────────┐   ┌─────────────┬───────────────────────────────┐
│ SESSION PROFILES    ＋ ⟳ │   │ PROFILES  ＋│ Name    [Alpha            ]   │
│  🖧 Alpha         ▶ ✎    │   │ ▸ Alpha     │ Shell   [Ubuntu (WSL)    ▾]   │
│    Ubuntu · claude --c…  │   │   Beta      │ Cwd     [/mnt/d/…/crowmac ]   │
│  ▣ Beta           ▶ ✎    │   │             │ ☑ Show in terminal dropdown   │
│    host shell · npm run… │   │             │ Commands                      │
└──────────────────────────┘   │             │  1 [claude --continue] ↑↓✕    │
   sidebar: navigate + launch  │             │  2 [npm run watch    ] ↑↓✕    │
                               └─────────────┴───────────────────────────────┘
                                            the editor: everything at once
```

## Session profiles

A profile is a named recipe. Create one from the sidebar's **＋**, or right-click any terminal and choose **Save as Instance Profile** to start from a terminal you already have open.

- **Sidebar** — every profile, with an inline ▶ to launch and ✎ to edit. Clicking a profile edits it rather than launching, because spawning processes is too consequential for a single click.
- **Editor** — all fields at once: name, shell, directory, and an ordered command list you can reorder and delete inline.
- **Terminal `+` dropdown** — tick *Show in the terminal `+` dropdown* and the profile is mirrored into `terminal.integrated.profiles`, appearing there by name. Commands still run, because the extension replays them whenever a terminal opens with a matching name.

Commands run in order once shell integration reports ready. **Every command but the last is awaited**, so a long-lived process such as `claude` belongs last. They are stored and replayed **literally** — write `claude --continue` to rejoin the most recent conversation in that directory, or `claude --resume <id>` to pin an exact one.

### Restoring after a restart

VS Code brings terminal *tabs* back, but not what was running in them: a revived tab is a fresh default-profile shell with replayed scrollback. Terminal Sessions closes that gap. Launched profiles are remembered per workspace and reopened automatically on startup, or on demand from the **Restore** chip in the status bar.

A terminal whose process genuinely survived is left alone rather than replaced — the process id recorded at launch is compared against the one that came back, because the two cases are indistinguishable by name and getting it wrong would kill a live session.

## Columns

The Explorer, terminal and chat panes can be shown and hidden independently from status-bar chips, with visibility remembered per workspace. These drive VS Code's **real containers** — the primary sidebar, the panel, and the secondary sidebar — rather than recreating them, which is what keeps the terminal's right-hand terminal list and the genuine Claude and Codex chat shells.

The editor is not a column: it is the space left over once the other three have taken theirs, so there is nothing to hide it into.

## Commands

| Command | Default key |
|---|---|
| Manage Instance Profiles | — |
| New Instance Profile / Open Profile / Edit Profile | — |
| Save as Instance Profile | terminal right-click |
| Restore Last Session | status-bar chip |
| Toggle Files / Terminal / Chat | `Ctrl+Alt+1` / `3` / `4` |
| New Terminal in Column | ``Ctrl+Shift+` `` |
| Grow / Shrink Focused Column | `Ctrl+Alt+←` / `→` |

## Settings

| Setting | Default | |
|---|---|---|
| `terminalSessions.instanceProfiles` | `[]` | Saved recipes. Hand-editable. |
| `terminalSessions.autoRestoreSession` | `true` | Reopen saved profiles on startup. |
| `terminalSessions.restoreDelayMs` | `3000` | Wait for VS Code's own revival first, so tabs aren't duplicated. |
| `terminalSessions.autoEnableEverywhere` | `true` | Bring the column layout up in every workspace. |
| `terminalSessions.columns` | built-in | Which containers the chips control. |

While enabled, three settings are managed at **global** scope and restored on disable: `terminal.integrated.defaultLocation`, `workbench.panel.defaultLocation`, and `terminal.integrated.persistentSessionReviveProcess` (widened to `onExitAndWindowClose`, without which terminals are lost when a window closes rather than the whole application).

## Why profiles are declared rather than captured

The obvious design is to right-click a terminal and save what it is doing. That is not possible, for two independent reasons:

- `Terminal.creationOptions` comes back **empty** for terminals VS Code launched from a profile, so the shell cannot be read back.
- Shell integration is **blind to nested shells**. With `claude` running inside `wsl` inside PowerShell, no shell-execution event ever fires for it.

At the moment of the right-click there is genuinely nothing to read, so a profile is declared once and replayed thereafter.

## Development

```bash
npm install
npm run watch     # then F5 to launch the Extension Development Host
npm run check-types
npm run package   # produces a .vsix
```

Every dependency is pure JavaScript and the build is plain `tsc`, deliberately: this repo lives on a Windows drive that may be driven from either Windows or WSL, and a single shared `node_modules` cannot hold a native binary that works for both. The npm scripts invoke `node ./node_modules/typescript/bin/tsc` directly rather than the `node_modules/.bin` shim, because a WSL `npm install` creates POSIX symlinks there instead of the `.cmd` shims Windows needs.

### Publishing

Published to the Visual Studio Marketplace as **`GBTI.terminal-sessions`**. Authenticate once with a
[personal access token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)
scoped to *Marketplace → Manage* for the `gbti-network` Azure DevOps organisation:

```bash
npx @vscode/vsce login GBTI

npm run package          # build + verify the .vsix locally first
npm run publish          # publish the current version
npm run publish:patch    # or bump, tag and publish in one step
npm run publish:openvsx  # Open VSX, for VSCodium and friends
```

Add the release notes to `CHANGELOG.md` before bumping — the marketplace renders it as the extension's
*Changelog* tab. The icon at `media/icon.png` is generated from `media/terminal-sessions.svg`.

## License

MIT
