# Public assets

Exported images that the README and the marketplace listing link to. Everything else under
`.product/` is local working material (sources, drafts, brand files) and stays out of git.

Committed because a listing image has to resolve after publish. A relative link in the README is
rewritten against the repository's raw content, so anything referenced here must exist on the default
branch.

Screenshots should be captures of the running extension, or renderings checked against it. People
decide whether to install from these, so a shot showing something the extension does not actually
render is a bug.

# Banners 
One note on the banner: typography is Liberation Sans and Liberation Mono, not Baloo Da 2 and JetBrains Mono, because those ship as woff2 only and there is no offline decoder here. The colours, the GBTI mark and the glyph are exact. 