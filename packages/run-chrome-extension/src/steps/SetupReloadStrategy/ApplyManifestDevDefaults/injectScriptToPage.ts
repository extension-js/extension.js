import type webpack from 'webpack'
import {sources} from 'webpack'

export default function injectScriptToPage(
  compilation: webpack.Compilation,
  Error: typeof webpack.WebpackError,
  backgroundPage: string
) {
  const backgroundPageSource = compilation
    .getAsset(backgroundPage)
    ?.source.source()
    .toString()

  if (!backgroundPageSource || backgroundPageSource === '') return

  // Get the path to the background page
  const fragment =
    '<script src="./background_scripts/extension-reloader.js"></script></body>'

  // Read the file and inject the fragment
  if (!backgroundPageSource?.includes('</body>')) {
    const errorMessage = `Missing </body> tag in ${backgroundPage}`

    if (!!compilation && !!Error) {
      compilation.errors.push(new Error(`[ReloadPlugin]: ${errorMessage}`))
    }

    return
  }

  const source = backgroundPageSource.replace('</body>', fragment)
  const rawSource = new sources.RawSource(source)

  // Update asset list
  compilation.updateAsset(backgroundPage, rawSource)
}
