// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {
  findPrefixedPermissionItems,
  prefixAppliesToBrowser
} from '../../../lib/manifest-utils'
import type {DevOptions} from '../../../types'
import {getOriginalManifest} from '../manifest-lib/manifest'
import * as messages from '../messages'

// "chromium:sidePanel" inside permissions used to ship as written, a string
// no browser knows. The build resolves it now and says which form is documented.
export class WarnPrefixedPermissionItems {
  public static readonly name: string =
    'manifest:warn-prefixed-permission-items'
  private readonly browser: DevOptions['browser']
  // A dev session re-reads the manifest on every save. One line per distinct
  // set of items is enough there, and production prints every build.
  private reported = new Set<string>()

  constructor(options: {browser: DevOptions['browser']}) {
    this.browser = options.browser
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      WarnPrefixedPermissionItems.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: WarnPrefixedPermissionItems.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const authored = getOriginalManifest(compilation)
            if (!authored) return

            const hits = findPrefixedPermissionItems(authored)
            if (!hits.length) return

            const signature = JSON.stringify(hits)

            if (compiler.options.mode === 'development') {
              if (this.reported.has(signature)) return

              this.reported.add(signature)
            }

            // The first item, written the documented way, with the plain
            // items of its list, which a prefixed key has to repeat.
            const [first] = hits
            const plainKey = first.key.substring(first.key.indexOf(':') + 1)
            const list = (authored as unknown as Record<string, unknown>)[
              first.key
            ]
            const plainItems = (Array.isArray(list) ? list : []).filter(
              (item): item is string =>
                typeof item === 'string' &&
                !hits.some((hit) => hit.key === first.key && hit.item === item)
            )

            // Pushed only, so the build report prints it once.
            const warn = new WebpackError(
              messages.permissionItemsCarryBrowserPrefix(
                String(this.browser || 'chrome'),
                hits.map((hit) => ({
                  ...hit,
                  kept: prefixAppliesToBrowser(hit.prefix, this.browser)
                })),
                {
                  key: `${first.prefix}:${plainKey}`,
                  items: [...plainItems, first.value]
                }
              )
            ) as Error & {file?: string; name?: string}

            warn.name = 'PrefixedPermissionItemWarning'
            warn.file = 'manifest.json'
            compilation.warnings.push(warn)
          }
        )
      }
    )
  }
}
