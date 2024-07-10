import {type Compiler, sources} from 'webpack'

interface Options {
  manifestPath: string
  browser: string
  exclude?: string[]
}

export default class HandleBrowserSpecificFields {
  private readonly manifestPath: string
  private readonly browser: string
  private readonly chromiumBasedBrowsers = ['chrome', 'edge', 'opera', 'brave']

  constructor(options: Options) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser
  }

  patchManifest(manifestSource: string) {
    const chromiumBasedBrowsers = this.chromiumBasedBrowsers
    const browser = this.browser

    const patchedManifest = JSON.parse(
      manifestSource,
      function reviver(this: any, key: string, value: any) {
        const indexOfColon = key.indexOf(':')

        // Retain plain keys.
        if (indexOfColon === -1) {
          return value
        }

        // Replace browser:key keys.
        const prefix = key.substring(0, indexOfColon)
        if (
          prefix === browser ||
          (prefix === 'chromium' && chromiumBasedBrowsers.includes(browser))
        ) {
          this[key.substring(indexOfColon + 1)] = value
        }

        // Implicitly delete the key otherwise.
      }
    )

    return JSON.stringify(patchedManifest, null, 2)
  }

  apply(compiler: Compiler) {
    compiler.hooks.emit.tapAsync(
      'HandleBrowserSpecificFields',
      (compilation, done) => {
        if (compilation.errors.length > 0) return

        const manifestSource = compilation
          .getAsset('manifest.json')
          ?.source.source()
        const patchedSource = this.patchManifest(
          (manifestSource || '{}').toString()
        )
        const rawSource = new sources.RawSource(patchedSource)

        compilation.updateAsset('manifest.json', rawSource)

        done()
      }
    )
  }
}
