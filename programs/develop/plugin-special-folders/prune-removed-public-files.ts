// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'

// What the copier shipped into each output folder on its last good compile.
// It outlives a compiler, so a session restart still knows what to remove.
const shippedByOutputPath = new Map<string, Set<string>>()

function removeShippedFile(outputPath: string, name: string): void {
  const root = path.resolve(outputPath)
  const target = path.resolve(root, name)
  if (!target.startsWith(root + path.sep)) return

  try {
    fs.rmSync(target, {force: true})

    let folder = path.dirname(target)

    while (folder.startsWith(root + path.sep)) {
      fs.rmdirSync(folder)
      folder = path.dirname(folder)
    }
  } catch {
    // Ignore
  }
}

// A watch session never cleans its output folder, so the copy of a public
// file deleted or renamed mid-session is removed here, and nothing else is.
export class PruneRemovedPublicFiles {
  public static readonly name: string =
    'plugin-special-folders:prune-removed-public-files'

  private readonly publicDir: string

  constructor(publicDir: string) {
    this.publicDir = publicDir
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.done?.tap) return

    compiler.hooks.done.tap(PruneRemovedPublicFiles.name, (stats) => {
      const compilation = stats.compilation
      const outputPath = compiler.options.output?.path
      if (!outputPath || compilation.errors.length > 0) return

      const emitted = new Set<string>()
      const shipped = new Set<string>()

      for (const asset of compilation.getAssets()) {
        const name = String(asset.name || '').replace(/\\/g, '/')
        emitted.add(name)
        if (asset.info?.copied) shipped.add(name)
      }

      for (const name of shippedByOutputPath.get(outputPath) || []) {
        if (emitted.has(name)) continue

        if (fs.existsSync(path.join(this.publicDir, name))) {
          shipped.add(name)
          continue
        }

        removeShippedFile(outputPath, name)
      }

      shippedByOutputPath.set(outputPath, shipped)
    })
  }
}
