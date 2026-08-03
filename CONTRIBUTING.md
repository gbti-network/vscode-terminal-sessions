# Contributing

Notes for working on this extension. Kept out of the README on purpose: `.vscodeignore` excludes this
file, so nothing here reaches the marketplace listing, where build instructions and design rationale
are noise to someone deciding whether to install.

## Build

```bash
npm install
npm run watch     # then F5 to launch the Extension Development Host
npm run check-types
npm test          # compiles, then node --test
npm run package   # produces a .vsix
```

Every dependency is pure JavaScript and the build is plain `tsc`, deliberately: this repo lives on a
Windows drive that may be driven from either Windows or WSL, and a single shared `node_modules` cannot
hold a native binary that works for both. The npm scripts invoke `node
./node_modules/typescript/bin/tsc` directly rather than the `node_modules/.bin` shim, because a WSL
`npm install` creates POSIX symlinks there instead of the `.cmd` shims Windows needs.

## Tests

They add no dependency either: `node --test` is built in. They run against `src/core/`, which imports
nothing from `vscode` and holds the decisions worth asserting on: the scope arithmetic for saved
profiles, the snapshot of settings the column layout overrides, and when session restore may begin.
All three are plain functions over values, and all three are where this extension's worst defects have
lived.

Anything that decides *what* to write, *whether* to dispose a terminal, or *when* to act belongs in
`src/core/` rather than in the module that calls the API. The point is not purity. It is that a defect
which destroys a profile can be reproduced without a window on screen.

## Publishing

Published as **`GBTI.gbti-terminal-sessions`** to the Visual Studio Marketplace and to Open VSX.
Authenticate once with a
[personal access token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)
scoped to *Marketplace > Manage* for the `gbti-network` Azure DevOps organisation:

```bash
npx @vscode/vsce login GBTI

npm run package          # build and verify the .vsix locally first
npm run publish          # publish the current version
npm run publish:patch    # or bump, tag and publish in one step
npm run publish:openvsx  # Open VSX, for VSCodium and friends
```

Add the release notes to `CHANGELOG.md` before bumping. The marketplace renders it as the extension's
*Changelog* tab. The icon at `media/icon.png` is generated from `media/terminal-sessions.svg`.

Two things worth doing every time:

- **Run `npx @vscode/vsce ls` and read it.** A file that `.gitignore` hides is not a file
  `.vscodeignore` hides, and that gap has shipped a stray screenshot and a pair of test files to
  users. The ignore file is not evidence; the file list is.
- **Verify the published version through the API, not the CLI's success message.** Query with
  `flags=951`; a narrower flag set returns a stale view that shows the previous version minutes after
  a successful publish. Open VSX indexes in about three minutes, the marketplace in about five, so a
  check inside the first three minutes always looks like failure.

## Why profiles are declared rather than captured

The obvious design is to right-click a terminal and save what it is doing. That is not possible, for
two independent reasons:

- `Terminal.creationOptions` comes back **empty** for terminals VS Code launched from a profile, so
  the shell cannot be read back.
- Shell integration is **blind to nested shells**. With `claude` running inside `wsl` inside
  PowerShell, no shell-execution event ever fires for it.

At the moment of the right-click there is genuinely nothing to read, so a profile is declared once and
replayed thereafter.

## The two halves are independent

Session profiles and the column layout share an extension, not a switch. **Enable / Disable Column
Layout** governs the columns and nothing else: profiles, replay and session restore keep working with
the layout off, driven only by `terminalSessions.autoRestoreSession` and the profiles you have saved.
There is deliberately no master on/off, because the Extensions view already is one.

Disabling the layout sticks. It outranks `layout.autoEnableEverywhere`, so a workspace you turned it
off in stays off across reloads rather than being re-enabled by the blanket default. The stored flag
is tri-state for exactly this reason: "never decided" and "turned off on purpose" have to be told
apart.

## The editor and terminal share one lever

Hiding the editor hands its space to the terminal column. That coupling comes from VS Code itself:
`workbench.action.toggleEditorVisibility` is a one-line delegation to `toggleMaximizedPanel()`, so
hiding the editor and maximizing the panel are the same operation.

Two things follow, and both are load-bearing in `src/layout/engine.ts`:

- The two columns move each other, and can never both be hidden. Hiding the editor reveals the
  terminal column if it was closed, because the space has to go somewhere. Hiding the terminal while
  the editor is hidden brings the editor back, since VS Code un-maximizes the panel on its way out,
  and the editor chip lights up with it. `setHidden` carries both directions and pre-seeds `applied`
  so the follow-up pass does not undo what the workbench already did.
- The chip can show the wrong state. Hide the editor from VS Code's own **View > Appearance** menu and
  the chip will not know, because the real state lives in a context key (`mainEditorAreaVisible`) that
  extensions can set but never read. The other three chips share that blind spot when their containers
  are closed by their own title-bar buttons. There is no API that reads container visibility, checked
  against `@types/vscode` 1.125.0; the only signal available is `visible` on a view the extension owns
  inside the container, which would mean contributing a permanently visible tab.

On a host too old to have either command the editor column is dropped rather than shown doing nothing,
which is what `editorColumnSupported()` resolves once at `init`.

The editor has no absolute show command, only a toggle, so `apply()` may only touch it to make a
change. That contract was violated by the empty `applied` cache on every activation, which is the
critical defect fixed in 0.5.0. `seedApplied()` exists to hold it.

## Settings the layout takes over

While the column layout is enabled, four settings are managed at **global** scope and restored when
you disable it:

| Setting | Set to | Why |
|---|---|---|
| `terminal.integrated.defaultLocation` | `view` | Otherwise Terminal > New Terminal can drop a shell into the editor area, working around the layout |
| `workbench.panel.defaultLocation` | the terminal column's position | So the panel reappears on the right edge rather than its old one |
| `terminal.integrated.persistentSessionReviveProcess` | `onExitAndWindowClose` | The default is `onExit`, meaning *application* exit, so closing a window loses terminals outright |
| `workbench.panel.opensMaximized` | `never` | Its default reopens the panel maximized if it was maximized when last closed, which would hide the editor column with no chip click, from runtime state no API can read |

The snapshot of the user's original values is stored in **global** state, not per workspace, because
the settings it protects are global. Keys the user had never set are recorded as captured-with-no-value
rather than as `undefined`, since extension state crosses to the host as JSON and `JSON.stringify`
drops `undefined` properties. Both of those were shipped defects before 0.5.0; see
`.data/sow/3_completed/sow-004-source-integrity-audit.md`.
