// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import {prependToEmittedAsset} from '../../../lib/asset-source-maps'
import {
  carriesCompletionValue,
  closeCompletionValueBlock
} from '../scripts-lib/completion-value'

const SCRIPTS_FILE = /^scripts\/.+\.js$/i
const HOT_UPDATE = /\.hot-update\./i

function parsesAsScript(text: string): boolean {
  try {
    // eslint-disable-next-line no-new-func
    new Function(text)

    return true
  } catch {
    return false
  }
}

// executeScript resolves with the value an injected file ends on. A bundle
// ends on its own wrapping, so a scripts/ file is closed on that value again.
export class KeepCompletionValue {
  public static readonly name: string = 'scripts:keep-completion-value'

  public apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return

    compiler.hooks.thisCompilation.tap(
      KeepCompletionValue.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: KeepCompletionValue.name,
            // After minification, so the block ships as written.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 100
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!SCRIPTS_FILE.test(asset.name)) continue
              if (HOT_UPDATE.test(asset.name)) continue

              const text = asset.source.source().toString()
              if (!carriesCompletionValue(text)) continue

              const {open, closed} = closeCompletionValueBlock(text)
              // A module file cannot sit in a block, so it stays as built.
              if (!parsesAsScript(`${open}${closed}`)) continue

              prependToEmittedAsset(
                compilation,
                {name: asset.name, source: {source: () => closed}},
                open
              )
            }
          }
        )
      }
    )
  }
}
