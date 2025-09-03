import {type Compiler} from '@rspack/core'
import * as messages from '../../../webpack-lib/messages'

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

        try {
          const text = asset.source.source().toString()
          legacy.forEach((needle) => {
            if (text.includes(needle)) {
              console.warn(messages.legacyManifestPathWarning(needle))
            }
          })
        } catch {}
      }
    )
  }
}
