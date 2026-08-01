# Contributing conventions

## Writing: no em-dashes in Markdown

Never use an em-dash (`—`) in any `.md` file in this repository, committed or not.

Do not substitute an en-dash (`–`) or a spaced hyphen (` - `). Those are the same construction in
disguise. Rewrite the sentence with the punctuation the clause actually calls for: commas or
parentheses for an aside, a colon to introduce an explanation, a full stop or semicolon to join two
independent statements, a new sentence for a trailing afterthought.

Hyphens in compound words (`built-in`, `read-only`, `per-workspace`) are fine, as are the `---`
fences of YAML frontmatter and horizontal rules. The rule covers Markdown only, not code comments.

## Commits

Commit messages carry no attribution trailers of any kind: no `Co-Authored-By`, no `Generated with`,
no session links, no tool credits. The message describes the change and nothing else.

Commits are authored as `gbtilabs` via the GitHub noreply address, and are not cryptographically
signed:

```bash
git config user.name  gbtilabs
git config user.email 125175036+gbtilabs@users.noreply.github.com
```

## Not committed

`.data/` (scopes of work and planning notes), `.product/` and `.snapshots/` are local working
directories. All three are in `.gitignore` and stay out of version control.

## Build

Every dependency is pure JavaScript and the build is plain `tsc`, deliberately. This repository lives
on a Windows drive that may be driven from either Windows or WSL, and a single shared `node_modules`
cannot hold a native binary that works for both. The npm scripts invoke
`node ./node_modules/typescript/bin/tsc` directly rather than the `node_modules/.bin` shim, because a
WSL `npm install` creates POSIX symlinks there instead of the `.cmd` shims Windows needs.

```bash
npm install
npm run watch        # then F5 for the Extension Development Host
npm run check-types
npm run package      # produces a .vsix
```
