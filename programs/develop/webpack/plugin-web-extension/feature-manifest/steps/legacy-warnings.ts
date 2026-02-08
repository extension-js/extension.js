// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compiler, WebpackError} from '@rspack/core'
import * as messages from '../messages'

export class ManifestLegacyWarnings {
  public static readonly name: string = 'manifest:legacy-warnings'

  apply(compiler: Compiler) {
    if ((compiler.options.mode || 'development') === 'production') return

    const legacy = [
      'devtools_page/devtools_page.html',
      'options_ui/page.html',
      'background/page.html',
      'browser_action/default_popup.html',
      'page_action/default_popup.html',
      'side_panel/default_path.html',
      'sidebar_action/default_panel.html'
    ]

    compiler.hooks.thisCompilation.tap(
      ManifestLegacyWarnings.name,
      (compilation) => {
        const asset = compilation.getAsset('manifest.json')
        if (!asset) return

        const text = asset.source.source().toString()
        let count = 0

        legacy.forEach((needle) => {
          if (text.includes(needle)) {
            const warn = new WebpackError(
              messages.legacyManifestPathWarning(needle)
            ) as Error & {file?: string; name?: string}
            warn.name = 'ManifestLegacyWarning'
            warn.file = 'manifest.json'
            compilation.warnings.push(warn)
            count++
          }
        })
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(messages.manifestLegacyWarningsSummary(count))
        }
      }
    )
  }
}
