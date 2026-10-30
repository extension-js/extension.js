// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {isChromiumBasedBrowser} from '../../../lib/constants'
import type {DevOptions} from '../../../types'
import {setCurrentManifestContent} from '../../feature-manifest/manifest-lib/manifest'
import {
  getCanonicalContentScriptEntryName,
  getCanonicalContentScriptJsAssetName
} from '../contracts'
import {getMainWorldBridgePairs} from './add-content-script-wrapper/get-bridge-scripts'

// The runtime pieces that resolve a URL against the extension base. A MAIN
// bundle that needs none of them never reads the base the bridge publishes.
const BASE_READERS = [
  'publicPath',
  'baseURI',
  'baseUri',
  'ensureChunk',
  'loadScript'
]

// The bridge writes the extension's base URL onto every matching page, where
// any site script can read it, so a production build ships it only for a
// MAIN-world bundle that resolves URLs against that base and cannot find it
// on its own.
export class PruneMainWorldBridges {
  constructor(
    private readonly options: {
      manifestPath: string
      browser?: DevOptions['browser']
    }
  ) {}

  apply(compiler: Compiler) {
    if (compiler.options?.mode !== 'production') return
    if (!compiler.webpack || !compiler.hooks?.thisCompilation) return

    // A Chromium MAIN bundle reads the base off its own stack, so it needs
    // no bridge at all. Elsewhere the stack names no extension file.
    const selfLocating = isChromiumBasedBrowser(
      String(this.options.browser || 'chrome')
    )
    const {RuntimeGlobals} = compiler.webpack
    const readers = new Set<string>(
      BASE_READERS.flatMap((key) => {
        const global = (RuntimeGlobals as Record<string, unknown>)[key]

        return typeof global === 'string' ? [key, global] : [key]
      })
    )

    compiler.hooks.thisCompilation.tap(
      PruneMainWorldBridges.name,
      (compilation) => {
        const readsBase = new Set<string>()

        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          PruneMainWorldBridges.name,
          (chunk, set) => {
            if (!chunk.name) return

            for (const requirement of set) {
              if (readers.has(String(requirement))) {
                readsBase.add(chunk.name)

                return
              }
            }
          }
        )

        compilation.hooks.processAssets.tap(
          {
            name: PruneMainWorldBridges.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 200
          },
          () => {
            const unneeded = getMainWorldBridgePairs(
              this.options.manifestPath,
              this.options.browser
            )
              .filter(
                ({mainIndex}) =>
                  selfLocating ||
                  !readsBase.has(getCanonicalContentScriptEntryName(mainIndex))
              )
              .map(({bridgeIndex}) =>
                getCanonicalContentScriptJsAssetName(bridgeIndex)
              )

            if (unneeded.length === 0) return

            const asset = compilation.getAsset('manifest.json')
            if (!asset) return

            let manifest: {content_scripts?: Array<{js?: string[]}>}

            try {
              manifest = JSON.parse(asset.source.source().toString())
            } catch {
              return
            }

            if (!Array.isArray(manifest.content_scripts)) return

            manifest.content_scripts = manifest.content_scripts.filter(
              (script) =>
                !(script.js || []).some((file) => unneeded.includes(file))
            )

            const source = JSON.stringify(manifest, null, 2)
            setCurrentManifestContent(compilation, source)
            compilation.updateAsset(
              'manifest.json',
              new sources.RawSource(source)
            )

            for (const file of unneeded) {
              for (const name of [file, `${file}.map`]) {
                if (compilation.getAsset(name)) compilation.deleteAsset(name)
              }
            }
          }
        )
      }
    )
  }
}
