// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {isChromiumBasedBrowser} from '../../../lib/constants'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {
  isInjectedSheet,
  rootedAtExtension
} from '../scripts-lib/injected-sheet-urls'

// Chromium resolves a url() in a sheet it injects against the visited page,
// where Firefox resolves it against the extension the sheet came from.
export class RootInjectedSheetUrls {
  public static readonly name: string = 'scripts:root-injected-sheet-urls'

  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList

  constructor(options: Pick<PluginInterface, 'browser' | 'includeList'>) {
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return
    if (!isChromiumBasedBrowser(String(this.browser))) return

    const runtimeEntries = Object.keys(this.includeList).filter((feature) =>
      feature.startsWith('scripts/')
    )

    compiler.hooks.thisCompilation.tap(
      RootInjectedSheetUrls.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: RootInjectedSheetUrls.name,
            // Behind every step that reads a sheet for the files it names,
            // which all expect a target spelled from the output root.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 500
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!isInjectedSheet(asset.name, runtimeEntries)) continue

              const before = asset.source.source().toString()
              const after = rootedAtExtension(before)
              if (after === before) continue

              compilation.updateAsset(asset.name, new sources.RawSource(after))
            }
          }
        )
      }
    )
  }
}
