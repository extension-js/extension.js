// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'

// The asset module files each output folder got on its last good compile.
// It outlives a compiler, so a session restart still knows what to remove.
const writtenByOutputPath = new Map<string, Set<string>>()

function removeWrittenFile(outputPath: string, name: string): void {
  const root = path.resolve(outputPath)
  const target = path.resolve(root, name)
  if (!target.startsWith(root + path.sep)) return

  try {
    fs.rmSync(target, {force: true})
  } catch {
    // A file in use stays: pruning must never fail a compile.
  }
}

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
        if (!emitted.has(name)) removeWrittenFile(outputPath, name)
      }

      writtenByOutputPath.set(outputPath, written)
    })
  }
}
