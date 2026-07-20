// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Root-absolute reference fallback (Chrome resolves a leading '/' from the
// EXTENSION ROOT): runs over EMITTED assets, additive, public/ still wins.

import * as fs from 'node:fs'
import {type Compilation, rspack} from '@rspack/core'
import {
  extractStaticImportLiterals,
  resolveExtensionPath
} from '../plugin-web-extension/feature-scripts/steps/trace-runtime-loaded-files'
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
  // JS modules copied verbatim keep their static import graph, so the closure
  // must ship too or the import fetch 404s at runtime.
  let pendingJs: Array<{name: string; content: string}> = []

  // Fixed point: a copied CSS file can itself carry root refs; keep scanning
  // newly emitted assets until nothing new turns up.
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

    for (const item of pendingJs) {
      for (const literal of extractStaticImportLiterals(item.content)) {
        const distRel = resolveExtensionPath(literal, item.name)
        if (distRel) refs.add(`/${distRel}`)
      }
    }
    pendingJs = []

    if (refs.size === 0) return

    let emitted = 0
    for (const ref of refs) {
      const outputName = ref.replace(/^\/+/, '')
      // Something in the build already owns this output path, don't clobber it.
      if (compilation.getAsset(outputName)) continue

      const sourcePath = resolveRootAbsoluteRef(ref, context, publicDir)
      if (!sourcePath) continue

      try {
        const buffer = fs.readFileSync(sourcePath)
        compilation.emitAsset(outputName, new rspack.sources.RawSource(buffer))
        // Keep watch mode honest: editing the file should rebuild.
        compilation.fileDependencies.add(sourcePath)
        emitted++
        if (/\.(?:js|mjs)$/i.test(outputName)) {
          pendingJs.push({name: outputName, content: buffer.toString()})
        }
      } catch {
        // A file we cannot read is not worth failing the whole build over; the
        // existing missing-file reporting still surfaces the broken ref.
      }
    }

    if (emitted === 0) return
  }
}
