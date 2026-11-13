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
  closeCompletionValueBlock,
  endsOnCompletionValue
} from '../scripts-lib/completion-value'

const SCRIPTS_FILE = /^scripts\/.+\.js$/i
const injectedFiles = new WeakMap<object, Set<string>>()

// A file the build compiled for executeScript from outside scripts/.
export function keepCompletionValueOf(
  compilation: object,
  assetName: string
): void {
  const files = injectedFiles.get(compilation) || new Set<string>()

  files.add(assetName)
  injectedFiles.set(compilation, files)
}

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
              const injected =
                injectedFiles.get(compilation)?.has(asset.name) === true
              if (!injected && !SCRIPTS_FILE.test(asset.name)) continue
              if (HOT_UPDATE.test(asset.name)) continue

              const text = asset.source.source().toString()

              // Such a file ends on the names it shares, so it is closed
              // on its own value even when no statement of it leaves one.
              if (
                injected
                  ? endsOnCompletionValue(text)
                  : !carriesCompletionValue(text)
              ) {
                continue
              }

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
