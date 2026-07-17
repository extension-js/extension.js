# Vendored — `webpack-target-webextension`

This directory is a **vendored fork** of the third-party
[`webpack-target-webextension`](https://github.com/awesome-webextension/webpack-target-webextension)
plugin, adapted for Extension.js's reload strategy.

## Type boundary (deliberate decision)

This is the **explicit boundary** for the manifest-types work: the casts inside
this fork are **out of scope** and are intentionally left as-is.

- The fork targets the upstream **`webpack`** `Compiler`/runtime-module types, not
  the Extension.js **`Manifest`** type in `programs/develop/types.ts`. Its `as any`
  casts sit against webpack-5 runtime-module internals (`AutoPublicPath`,
  `LoadScript`, etc.), **not** against the manifest shape this patch tightens.
- Typing those casts would mean reverse-engineering and re-deriving upstream
  webpack-internal contracts — a separate concern from "make the plugin mean what
  *its* manifest types say". Doing it blindly would risk drifting from upstream
  and complicating future re-syncs with the source project.

The boundary is therefore: **the fork keeps its own (untyped) edges; the
Extension.js manifest pipeline around it is the surface that gets the real
`Manifest` types.** Re-sync this directory from upstream rather than hand-editing
its types.
