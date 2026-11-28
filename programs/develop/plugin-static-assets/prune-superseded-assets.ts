// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {removeOutputFile} from '../lib/remove-output-file'

// The asset module files each output folder got on its last good compile.
// It outlives a compiler, so a session restart still knows what to remove.
const writtenByOutputPath = new Map<string, Set<string>>()

// A watch session never cleans its output folder, so an edited image or font
// would leave each earlier content-hashed copy behind. Only names an asset
// module wrote are removed, never a file another step or the user put there.
export class PruneSupersededAssets {
  public static readonly name: string =
    'plugin-static-assets:prune-superseded-assets'

  apply(compiler: Compiler) {
    compiler.hooks.done.tap(PruneSupersededAssets.name, (stats) => {
      if (!compiler.watchMode) return

      const compilation = stats.compilation
      const outputPath = compiler.options.output?.path
      if (!outputPath || compilation.errors.length > 0) return

      const emitted = new Set<string>()
      const written = new Set<string>()

      for (const asset of compilation.getAssets()) {
        const name = String(asset.name || '').replace(/\\/g, '/')
        emitted.add(name)

        if (asset.info?.sourceFilename && !asset.info?.copied) {
          written.add(name)
        }
      }

      for (const name of writtenByOutputPath.get(outputPath) || []) {
        if (!emitted.has(name)) removeOutputFile(outputPath, name)
      }

      writtenByOutputPath.set(outputPath, written)
    })
  }
}
