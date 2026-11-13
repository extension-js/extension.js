// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import {prependToEmittedAsset} from '../../../lib/asset-source-maps'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {
  namesSheet,
  runtimeScriptSheetBlock,
  runtimeScriptSheetName,
  withoutSheetBlock
} from '../scripts-lib/runtime-script-sheet'
import {isEntryFile} from '../scripts-lib/taken-extension-base'

// A scripts/ file is injected by a call the author wrote, which names only
// the script. So the sheet of its CSS modules rides in the script itself.
export class PlaceRuntimeScriptSheets {
  public static readonly name: string = 'scripts:place-runtime-script-sheets'

  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList

  constructor(options: Pick<PluginInterface, 'browser' | 'includeList'>) {
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return

    const entries = Object.keys(this.includeList).filter((feature) =>
      feature.startsWith('scripts/')
    )
    if (entries.length === 0) return

    const gecko = isGeckoBasedBrowser(String(this.browser))
    // A dev build adds its project folder, so two projects open at once
    // never share a sheet on the same page.
    const devSalt =
      compiler.options.mode === 'development'
        ? String(compiler.options.context || '')
        : ''

    compiler.hooks.thisCompilation.tap(
      PlaceRuntimeScriptSheets.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: PlaceRuntimeScriptSheets.name,
            // After the minifier, so the sheet is the one that would ship,
            // and ahead of every step that reads what the build emitted.
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
          },
          () => {
            const scripts = compilation
              .getAssets()
              .filter((asset) => asset.name.endsWith('.js'))

            for (const entryName of entries) {
              const sheetName = runtimeScriptSheetName(entryName)
              const sheet = compilation.getAsset(sheetName)
              if (!sheet) continue

              const script = scripts.find((asset) =>
                isEntryFile(asset.name, entryName)
              )
              if (!script) continue

              const css = sheet.source.source().toString()
              const built = withoutSheetBlock(script.source.source().toString())

              // An author who names the file places the sheet, with a call
              // or a fetch, so the script must not place a second copy.
              const named =
                namesSheet(built, sheetName) ||
                scripts.some(
                  (asset) =>
                    asset.name !== script.name &&
                    asset.source.source().toString().includes(sheetName)
                )

              prependToEmittedAsset(
                compilation,
                {name: script.name, source: {source: () => built}},
                css.trim() && !named
                  ? runtimeScriptSheetBlock({css, entryName, devSalt, gecko})
                  : ''
              )

              if (named) continue

              compilation.deleteAsset(sheetName)

              if (compilation.getAsset(`${sheetName}.map`)) {
                compilation.deleteAsset(`${sheetName}.map`)
              }
            }
          }
        )
      }
    )
  }
}
