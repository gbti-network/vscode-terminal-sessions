# Changelog

All notable changes to **Terminal Sessions** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-07-30

Initial public release on the Visual Studio Marketplace.

### Session profiles

- **Named terminal recipes** — a profile records which shell to open (a WSL distro or an explicit
  shell path), which directory to open it in, and an ordered list of commands to run once shell
  integration reports ready.
- **Authoring three ways** — the sidebar's **＋**, the full-page editor (*Manage Instance Profiles*),
  or **Save as Instance Profile** from any terminal's right-click menu.
- **Sidebar view** — every profile in an activity-bar container, with inline ▶ to launch and ✎ to
  edit. Clicking a profile opens the editor rather than launching it, because spawning processes is
  too consequential for a single click.
- **Terminal `+` dropdown** — profiles can be mirrored into `terminal.integrated.profiles` and
  launched from VS Code's own terminal picker, commands included.
- **Literal command replay** — commands are stored and replayed verbatim, so `claude --continue`
  rejoins the most recent conversation in that directory. Every command but the last is awaited, so
  a long-lived process belongs last. Per-command `waitMs` overrides the 3000 ms default.

### Session restore

- **Automatic restore on startup** — launched profiles are remembered per workspace and reopened
  after a restart, closing the gap VS Code leaves: it revives terminal *tabs*, but a revived tab is a
  fresh default-profile shell with replayed scrollback, not the process you left running.
- **Live processes are never killed** — the process id recorded at launch is compared against the one
  that came back, so a terminal that genuinely survived is left alone rather than replaced.
- **Manual control** — *Restore Last Session* from the status bar or palette, and *Stop Restoring a
  Profile…* to drop one from the restore set.
- `terminalSessions.restoreDelayMs` (default 3000) holds restore until VS Code's own terminal revival
  has finished, so tabs are not duplicated.

### Columns

- **Explorer, editor, terminal and chat as collapsible columns**, toggled from status-bar chips or
  `Ctrl+Alt+1` / `2` / `3` / `4`, with visibility remembered per workspace. These drive VS Code's real
  containers — primary sidebar, editor area, panel, secondary sidebar — rather than recreating them,
  which keeps the terminal's own terminal list and the genuine Claude and Codex chat shells intact.
- **The editor column is coupled to the terminal one, by construction.** VS Code hides the editor area
  by maximizing the panel over it, so the editor's space goes to the panel column: the two can never
  be hidden together, and each moves the other. Hiding the editor reveals the terminal column if it
  was closed; hiding the terminal un-maximizes the panel and so brings the editor back, and its chip
  with it. On a host with neither `workbench.action.toggleEditorVisibility` nor
  `workbench.action.toggleMaximizedPanel` the chip is dropped rather than shown doing nothing.
- **One column always stays open.** The last visible column refuses to hide, so the layout cannot be
  emptied to a window with no chip lit to recover from.
- **The layout's switch is its own.** *Enable / Disable Column Layout* governs the columns and nothing
  else — session profiles, replay and restore run with the layout off, driven only by
  `terminalSessions.autoRestoreSession` and your saved profiles. There is no master on/off for the
  extension; the Extensions view already is one. The settings moved to match:
  `terminalSessions.layout.autoEnable` and `terminalSessions.layout.autoEnableEverywhere`, with the
  unprefixed names still read when the new ones are unset.
- **Disabling the layout sticks.** It outranks `layout.autoEnableEverywhere`, so a workspace you
  turned it off in stays off across reloads instead of being re-enabled on the next window.
- **Grow / shrink the focused column** with `Ctrl+Alt+←` / `→`, plus *Reset Layout*.
- **New Terminal in Column** on ``Ctrl+Shift+` `` while enabled.
- `terminalSessions.columns` allows the set of controlled containers to be redefined.
- While enabled, four settings are managed at global scope and restored on disable:
  `terminal.integrated.defaultLocation`, `workbench.panel.defaultLocation`,
  `terminal.integrated.persistentSessionReviveProcess` (widened to `onExitAndWindowClose`, without
  which terminals are lost when a window closes rather than the whole application), and
  `workbench.panel.opensMaximized` (pinned to `never`, so reopening the terminal cannot hide the
  editor column without a chip click). The snapshot backfills keys added by later versions, so a
  setting first managed by an upgrade is still restored on disable.

[0.2.0]: https://github.com/gbti-network/vscode-terminal-sessions/releases/tag/v0.2.0
