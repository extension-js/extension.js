import {type Compiler, sources} from 'webpack'
import {ManifestBase} from '../manifest-types'

interface Options {
  manifestPath: string
  browser: string
  exclude?: string[]
}

export default class HandleBrowserSpecificFields {
  private readonly manifestPath: string
  private browser: string
  private chromiumBasedBrowsers = ['chrome', 'edge', 'opera', 'brave']

  constructor(options: Options) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser
  }

  private processManifest(manifest: any): any {
    const result: any = {}

    for (const key in manifest) {
      if (manifest.hasOwnProperty(key)) {
        if (
          typeof manifest[key] === 'object' &&
          !Array.isArray(manifest[key])
        ) {
          result[key] = this.processManifest(manifest[key])
        } else if (
          key.startsWith(`${this.browser}:`) ||
          (key.startsWith('chromium:') &&
            this.chromiumBasedBrowsers.includes(this.browser))
        ) {
          result[key.replace(`${this.browser}:`, '').replace('chromium:', '')] =
            manifest[key]
        } else if (!key.includes(':')) {
          result[key] = manifest[key]
        }
      }
    }

    return result
  }

  apply(compiler: Compiler) {
    compiler.hooks.emit.tapAsync(
      'HandleBrowserSpecificFields',
      (compilation, done) => {
        if (compilation.errors.length > 0) return

        const manifestSource = compilation
          .getAsset('manifest.json')
          ?.source.source()
        const manifest: ManifestBase = JSON.parse(
          (manifestSource || '').toString()
        )
        const overrides = this.processManifest(manifest)

        const patchedManifest: ManifestBase = {
          ...manifest,
          ...JSON.parse(overrides)
        }

        const source = JSON.stringify(patchedManifest, null, 2)
        const rawSource = new sources.RawSource(source)

        compilation.updateAsset('manifest.json', rawSource)

        done()
      }
    )
  }
}
