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
  injectedSheetRoot,
  isInjectedSheet,
  namedInjectedSheets,
  rootedAtExtension,
  rootedAtExtensionFrom
} from '../scripts-lib/injected-sheet-urls'

// Chromium resolves a url() in a sheet it injects against the visited page.
// Firefox does the same for a sheet a script fetches into a style element.
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

    const root = injectedSheetRoot(String(this.browser))
    if (!root) return

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
            // A sheet named by file keeps its own relative targets, which
            // only Chromium reads against the page. Firefox reads the file's.
            const named = isChromiumBasedBrowser(String(this.browser))
              ? namedInjectedSheets(compilation)
              : new Set<string>()

            for (const asset of compilation.getAssets()) {
              const byFile = named.has(asset.name)

              if (!byFile && !isInjectedSheet(asset.name, runtimeEntries)) {
                continue
              }

              const before = asset.source.source().toString()
              const after = byFile
                ? rootedAtExtensionFrom(before, asset.name, root)
                : rootedAtExtension(before, root)
              if (after === before) continue

              compilation.updateAsset(asset.name, new sources.RawSource(after))
            }
          }
        )
      }
    )
  }
}
