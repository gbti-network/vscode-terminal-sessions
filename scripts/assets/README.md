# Banner assets

Inputs to `scripts/banner.html`. Build-time only: `.vscodeignore` excludes `scripts/**`, so none of
this reaches the packaged extension. They are committed rather than fetched so the banner can be
regenerated from a clean checkout.

## Fonts

The GBTI type stack, as Latin subsets of the variable faces, taken from the `@fontsource-variable`
packages at 5.2.8:

| File | Face | Used for |
|---|---|---|
| `baloo-da-2.woff2` | Baloo Da 2 | Display type and the wordmark |
| `hanken-grotesk.woff2` | Hanken Grotesk | UI text |
| `jetbrains-mono.woff2` | JetBrains Mono | Anything a shell would print |

All three are licensed under the SIL Open Font License 1.1, which permits redistribution with the
font. The extension itself is MIT; that covers the code, not these files.

## Mark

`gbti-mark.png` is the GBTI mint mark, copied unmodified from the brand assets. Mint strokes on
transparency, so the banner background shows through the counters.
