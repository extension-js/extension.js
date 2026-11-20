// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {listedCopiesOf} from '../web-resources-lib/resolve-war'

// The listed files each output folder got on its last good compile. It
// outlives a compiler, so a session restart still knows what to remove.
const copiedByOutputPath = new Map<string, Set<string>>()

function removeCopy(outputPath: string, name: string): void {
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
    // A folder that still holds files stays, and so does one in use.
  }
}

// A watch session never cleans its output folder, so the copy of a listed
// file that was deleted would keep shipping. It is removed here.
export class PruneRemovedWarCopies {
  public static readonly name: string = 'web-resources:prune-removed-copies'

  apply(compiler: Compiler) {
    compiler.hooks.done.tap(PruneRemovedWarCopies.name, (stats) => {
      const compilation = stats.compilation
      const outputPath = compiler.options.output?.path
      if (!compiler.watchMode) return
      if (!outputPath || compilation.errors.length > 0) return

      const copied = listedCopiesOf(compilation)

      for (const name of copiedByOutputPath.get(outputPath) || []) {
        if (!compilation.getAsset(name)) removeCopy(outputPath, name)
      }

      copiedByOutputPath.set(outputPath, copied)
    })
  }
}
