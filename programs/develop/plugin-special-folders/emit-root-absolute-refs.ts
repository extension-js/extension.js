// Root-absolute reference fallback (Chrome semantics).
//
// Chrome resolves a leading `/` from the EXTENSION ROOT. Extension.js only ever
// served such refs from `public/`, so a wild extension that keeps its assets at
// the source root shipped a broken build: the file was never copied to the
// output root, and the ref 404'd at runtime.
//
// This runs over the EMITTED assets rather than the sources, so one pass covers
// every producer uniformly — <script src="/x.js">, <link href="/x.css"> and
// CSS `url(/img/x.svg)` alike — without teaching each pipeline about root refs.
//
// Strictly additive: `public/` still wins, and only refs that actually exist at
// the extension root are claimed. A genuinely broken ref stays broken and is
// still reported.

import * as fs from 'fs'
import * as path from 'path'
import {rspack, type Compilation} from '@rspack/core'
import {
  collectRootAbsoluteRefs,
  resolveRootAbsoluteRef
} from '../plugin-web-extension/shared/paths'

export function emitRootAbsoluteRefs(
  compilation: Compilation,
  context: string,
  publicDir: string
) {
  const scanned = new Set<string>()

  // Fixed point: a CSS file we copy in for a root ref can itself carry root
  // refs (`/css/opt.css` -> `url(/img/warn.svg)`). It is not an asset yet when
  // the first scan runs, so a single pass would silently miss the svg. Keep
  // scanning newly emitted assets until nothing new turns up.
  for (let pass = 0; pass < 10; pass++) {
    const refs = new Set<string>()

    for (const asset of compilation.getAssets()) {
      if (!/\.(html|css)$/i.test(asset.name)) continue
      if (scanned.has(asset.name)) continue
      scanned.add(asset.name)

      let source: string
      try {
        source = String(asset.source.source())
      } catch {
        continue
      }
      for (const ref of collectRootAbsoluteRefs(source)) refs.add(ref)
    }

    if (refs.size === 0) return

    let emitted = 0
    for (const ref of refs) {
      const outputName = ref.replace(/^\/+/, '')
      // Something in the build already owns this output path — don't clobber it.
      if (compilation.getAsset(outputName)) continue

      const sourcePath = resolveRootAbsoluteRef(ref, context, publicDir)
      if (!sourcePath) continue

      try {
        compilation.emitAsset(
          outputName,
          new rspack.sources.RawSource(fs.readFileSync(sourcePath))
        )
        // Keep watch mode honest: editing the file should rebuild.
        compilation.fileDependencies.add(sourcePath)
        emitted++
      } catch {
        // A file we cannot read is not worth failing the whole build over; the
        // existing missing-file reporting still surfaces the broken ref.
      }
    }

    if (emitted === 0) return
  }
}

