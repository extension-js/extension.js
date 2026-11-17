// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {shippedPageAssets} from '../html-lib/shipped-page-assets'

// What the page steps shipped into each output folder on the last compile.
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

// A watch session never cleans its output folder, and a file a page names
// ships under a name made from its bytes. Each save of that file would leave
// the copy before it behind, so the copy no build ships anymore is removed.
export class PruneReplacedPageAssets {
  apply(compiler: Compiler) {
    compiler.hooks.done.tap('html:prune-replaced-page-assets', (stats) => {
      const compilation = stats.compilation
      const outputPath = compiler.options.output?.path
      if (!outputPath) return

      const shippedBefore = shippedByOutputPath.get(outputPath) || new Set()
      const shippedNow = shippedPageAssets(compilation)

      // A failed build ships no page files, so nothing is known to be
      // replaced yet. Both lists are kept for the next build that passes.
      if (compilation.errors.length > 0) {
        shippedByOutputPath.set(
          outputPath,
          new Set([...shippedBefore, ...shippedNow])
        )

        return
      }

      const emitted = new Set<string>()

      for (const asset of compilation.getAssets()) {
        emitted.add(String(asset.name || '').replace(/\\/g, '/'))
      }

      // A name another step still emits (a stylesheet that names the same
      // image) stays: only a file no part of this build ships is removed.
      for (const name of shippedBefore) {
        if (!emitted.has(name)) removeShippedFile(outputPath, name)
      }

      shippedByOutputPath.set(outputPath, new Set(shippedNow))
    })
  }
}
