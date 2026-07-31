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

- **Explorer, terminal and chat as collapsible columns**, toggled from status-bar chips or
  `Ctrl+Alt+1` / `3` / `4`, with visibility remembered per workspace. These drive VS Code's real
  containers — primary sidebar, panel, secondary sidebar — rather than recreating them, which keeps
  the terminal's own terminal list and the genuine Claude and Codex chat shells intact.
- **Grow / shrink the focused column** with `Ctrl+Alt+←` / `→`, plus *Reset Layout*.
- **New Terminal in Column** on ``Ctrl+Shift+` `` while enabled.
- `terminalSessions.columns` allows the set of controlled containers to be redefined.
- While enabled, three settings are managed at global scope and restored on disable:
  `terminal.integrated.defaultLocation`, `workbench.panel.defaultLocation`, and
  `terminal.integrated.persistentSessionReviveProcess` (widened to `onExitAndWindowClose`, without
  which terminals are lost when a window closes rather than the whole application).

[0.2.0]: https://github.com/gbti-network/vscode-terminal-sessions/releases/tag/v0.2.0
