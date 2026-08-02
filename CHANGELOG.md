# Changelog

All notable changes to **Terminal Sessions** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-08-01

### Changed

- The editor-column section is rewritten. It opened with three negations before saying what actually
  happens, so a reader had to hold "not like the others, not independent, not into nothing" before
  reaching a single positive statement. It now leads with the behaviour, that hiding the editor hands
  its space to the terminal column, and gives the mechanism second.
- The Commands table lists titles as they appear in the palette, prefixed **Terminal Sessions:**, with
  every command listed rather than merged rows, and names `Ctrl+Shift+P` for opening the palette. The
  old table listed names that could not be found by searching for them.
- Unicode arrows and ellipsis replaced with the characters a keyboard produces, and
  `Show or Hide Column...` now matches the command title it ships under.

## [0.4.1] - 2026-08-01

### Changed

- A profile is described as **a saved terminal setup** rather than "a named recipe". The metaphor was
  doing work that plain language does better, and the welcome view is the first thing a new user
  reads. Changed everywhere it ships: the welcome view, the settings help, the README and the listing
  screenshots.
- Listing screenshots regenerated. Their callouts are now positioned from the measured element boxes
  rather than hand-tuned offsets, so each marker sits on the control it describes, and the mocked
  editor chrome matches the real one.

## [0.4.0] - 2026-08-01

### Removed

- **The `Restore (N)` status bar chip.** It only ever offered to redo something
  `terminalSessions.autoRestoreSession` had already done on startup, so it read as a control with an
  unclear job while adding permanent noise beside the column chips, which are what the status bar is
  actually for. **Restore Last Session** stays in the command palette for the one case automation
  misses: running restore again after closing a restored terminal by hand. Nothing about restore
  itself changed.

## [0.3.3] - 2026-08-01

### Fixed

- **Save no longer fails silently.** A settings write can genuinely fail: an untrusted workspace,
  read-only settings, or a window whose configuration registry has lost the key after the extension
  was updated in place. The rejection went unhandled, so the button appeared to do nothing at all,
  with no profile and no error. A failed project write now falls back to global and says so, and any
  other failure is reported rather than swallowed.

## [0.3.2] - 2026-08-01

### Added

- **Show Session Profiles View**, for when the activity bar icon has gone missing. VS Code persists
  which container a view lives in and relocates an orphaned view to a default container when its own
  container id stops existing; a container left with no views is then hidden, taking the icon with
  it. The command reveals the view wherever it currently is, and offers to reset view locations if
  that fails. Nothing in the extension can read or set a view's location, so recovery has to go
  through VS Code's own commands.

## [0.3.1] - 2026-08-01

### Changed

- **Scope is set per profile, in the editor.** The profile form has a **Saved in** control naming
  where that profile lives, and changing it moves the profile on save. Scope is a property of a
  profile rather than a one-time migration, so it belongs on the profile.
- **The startup migration notice is gone.** A toast interrupted before there was any context for the
  question. Moving several profiles at once is still available from the palette as *Move Global
  Profiles into This Workspace*, and `terminalSessions.profileScope` now only seeds the scope a new
  profile starts at.
- With no folder open the **Saved in** control is disabled and explains why, rather than offering a
  choice that would be silently ignored.

## [0.3.0] - 2026-08-01

### Changed

- **Profiles are bound to a project by default.** They used to live only in user settings, so every
  project's recipes showed up in every window. New profiles now save to the project's
  `.vscode/settings.json`, and `terminalSessions.profileScope` switches that back to `global` for
  the handful that genuinely are portable. The sidebar always lists this project's profiles plus any
  global ones, marking the global ones so it is obvious which follow you around.
- Reading unions the two scopes rather than letting VS Code resolve them. For array settings VS Code
  replaces rather than merges, so a workspace list would otherwise hide the global list entirely.
- Editing a profile rewrites it where it already lives, so nothing moves scope behind your back.
  **Move Global Profiles into This Workspace** does it deliberately, and the same offer appears once
  per workspace when global profiles are found.
- The terminal dropdown mirror now writes at the profile's own scope. A workspace profile mirrored
  globally would have appeared in every other project's `+` dropdown, which is the leak this whole
  change exists to close.

### Fixed

- A failure to register the Session Profiles view no longer aborts activation. It throws when a
  second copy of the extension claims the same view id, which happens when an orphaned folder from a
  rename is still on disk, and it used to take the status bar chips and every command down with it.

## [0.2.4] - 2026-08-01

### Fixed

- Marketplace badges rendered the words "retired badge". shields.io retired its
  `visual-studio-marketplace` endpoints, and they still answer 200, so the breakage was invisible to
  a status check. Now served by `vsmarketplacebadges.dev`, which is on the marketplace badge
  allowlist. The rating badge is gone until there are ratings, since "0/5 (0)" reads as a bad score
  rather than an absent one.

## [0.2.3] - 2026-07-31

### Fixed

- Copyright is held by Gethsemane LLC, not an individual. The LICENSE shipped in earlier versions
  named the wrong holder.

## [0.2.2] - 2026-07-31

### Fixed

- The restore section claimed VS Code brings terminal tabs back on its own. It does not: closing a
  window loses them outright, because `persistentSessionReviveProcess` ships as `onExit`, meaning
  *application* exit. Widening it is what makes the tabs return at all, and that widening is
  something this extension does. The old wording described post-install behaviour as though it were
  stock, which read backwards to anyone who had not installed yet.

### Changed

- Screenshots and the settings help lead with `claude --resume Alpha`, pinning one exact session per
  profile, rather than `claude --continue`, which rejoins whatever ran last in that directory.
- README links to the marketplace listing, with version, install and rating badges.

## [0.2.1] - 2026-07-31

### Changed

- Annotated screenshots on the listing, replacing the ASCII diagram. That diagram used fullwidth and
  ambiguous-width glyphs, which line up in a terminal but not in the marketplace font, so its box
  edges came out ragged and it clipped in the narrow Extension view.
- No em-dashes in any shipped string. `describeProfile` put one between a profile's shell and its
  last command, so it appeared on every row of the sidebar; the diagnostics output and several
  setting descriptions carried them too.

## [0.2.0] - 2026-07-30

Initial public release on the Visual Studio Marketplace.

### Session profiles

- **Named terminal recipes.** A profile records which shell to open (a WSL distro or an explicit
  shell path), which directory to open it in, and an ordered list of commands to run once shell
  integration reports ready.
- **Authoring three ways.** The sidebar's **＋**, the full-page editor (*Manage Instance Profiles*),
  or **Save as Instance Profile** from any terminal's right-click menu.
- **Sidebar view.** Every profile in an activity-bar container, with inline ▶ to launch and ✎ to
  edit. Clicking a profile opens the editor rather than launching it, because spawning processes is
  too consequential for a single click.
- **Terminal `+` dropdown.** Profiles can be mirrored into `terminal.integrated.profiles` and
  launched from VS Code's own terminal picker, commands included.
- **Literal command replay.** Commands are stored and replayed verbatim, so `claude --continue`
  rejoins the most recent conversation in that directory. Every command but the last is awaited, so
  a long-lived process belongs last. Per-command `waitMs` overrides the 3000 ms default.

### Session restore

- **Automatic restore on startup.** Closing a VS Code window loses terminals outright by default,
  because `persistentSessionReviveProcess` ships as `onExit`, meaning *application* exit. Widening it
  to `onExitAndWindowClose` is what brings the tabs back at all. Even then a revived tab is a fresh
  default-profile shell with replayed scrollback, not the process you left running, so each tab
  matching a saved profile is disposed and relaunched as that profile.
- **Live processes are never killed.** The process id recorded at launch is compared against the one
  that came back, so a terminal that genuinely survived is left alone rather than replaced.
- **Manual control.** *Restore Last Session* from the status bar or palette, and *Stop Restoring a
  Profile…* to drop one from the restore set.
- `terminalSessions.restoreDelayMs` (default 3000) holds restore until VS Code's own terminal revival
  has finished, so tabs are not duplicated.

### Columns

- **Explorer, editor, terminal and chat as collapsible columns**, toggled from status-bar chips or
  `Ctrl+Alt+1` / `2` / `3` / `4`, with visibility remembered per workspace. These drive VS Code's real
  containers (primary sidebar, editor area, panel, secondary sidebar) rather than recreating them,
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
  else. Session profiles, replay and restore run with the layout off, driven only by
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
