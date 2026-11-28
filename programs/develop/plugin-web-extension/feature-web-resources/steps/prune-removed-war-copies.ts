// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {removeOutputFile} from '../../../lib/remove-output-file'
import {listedCopiesOf} from '../web-resources-lib/resolve-war'

// The listed files each output folder got on its last good compile. It
// outlives a compiler, so a session restart still knows what to remove.
const copiedByOutputPath = new Map<string, Set<string>>()

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
        if (!compilation.getAsset(name)) removeOutputFile(outputPath, name)
      }

      copiedByOutputPath.set(outputPath, copied)
    })
  }
}
