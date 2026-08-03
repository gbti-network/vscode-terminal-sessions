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
| `01-profiles.png`, `02-editor.png`, `03-columns.png` | `scripts/screenshots.html` | `node scripts/capture-screenshots.mjs` |
| `demo-thumbnail.jpg` | `.product/video/thumbnail.html` | `node .product/video/shoot-thumbnail.mjs`, then copy `out/thumbnail.jpg` here |

`demo-thumbnail.jpg` is the YouTube thumbnail, committed here because the README links it to the
video and the marketplace strips `<video>` from a listing, so a linked still is the only way a demo
reaches someone reading the page. It is a copy rather than a second design on purpose: two thumbnails
for one video would drift.

Only images the README actually links to belong in here. The banner is built by
`scripts/banner.html` and `node scripts/capture-banner.mjs`, but the README does not use it, so its
output lands in `.product/branding/` instead. It exists for surfaces outside the repository, such as
the GitHub social preview, which is an upload rather than a committed file.

`demo-1080p.mp4` is built by `scripts/capture-demo.mjs` from `scripts/demo.html`. It is gitignored,
because a master runs to hundreds of MB and the marketplace strips `<video>` from a README anyway.

The banner uses the real GBTI type stack, Baloo Da 2 and JetBrains Mono, along with the mint mark and
the extension's own glyph. An earlier note here recorded a substitution to Liberation, on the
reasoning that the brand faces ship as woff2 only with no offline decoder. A browser decodes woff2
natively, so rendering the banner in one removed the need. See `scripts/assets/README.md` for the
font licences.
