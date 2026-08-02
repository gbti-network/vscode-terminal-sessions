# Public assets

Exported images that the README and the marketplace listing link to. Everything else under
`.product/` is local working material (sources, drafts, brand files) and stays out of git.

Committed because a listing image has to resolve after publish. A relative link in the README is
rewritten against the repository's raw content, so anything referenced here must exist on the default
branch.

Screenshots should be captures of the running extension, or renderings checked against it. People
decide whether to install from these, so a shot showing something the extension does not actually
render is a bug.

Everything here has a source in `scripts/`. Nothing should be hand-made: an asset with no generator
cannot be corrected without redrawing it, which is how four unusable banner drafts accumulated.

## What is here

| File | Source | Regenerate |
|---|---|---|
| `banner.webp` | `scripts/banner.html` | `node scripts/capture-banner.mjs` |
| `01-profiles.png`, `02-editor.png`, `03-columns.png` | `scripts/screenshots.html` | Serve the directory and screenshot each `.frame` |

`demo-1080p.mp4` is built by `scripts/capture-demo.mjs` from `scripts/demo.html`. It is gitignored,
because a master runs to hundreds of MB and the marketplace strips `<video>` from a README anyway.

The banner uses the real GBTI type stack, Baloo Da 2 and JetBrains Mono, along with the mint mark and
the extension's own glyph. An earlier note here recorded a substitution to Liberation, on the
reasoning that the brand faces ship as woff2 only with no offline decoder. A browser decodes woff2
natively, so rendering the banner in one removed the need. See `scripts/assets/README.md` for the
font licences.
