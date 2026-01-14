//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type Compiler, Compilation, sources} from '@rspack/core'
import * as messages from './compatibility-lib/messages'
import {
  getManifestContent,
  filterKeysForThisBrowser
} from './compatibility-lib/manifest'
import type {PluginInterface, Manifest, DevOptions} from '../webpack-types'

function countBrowserPrefixedKeys(obj: any): number {
  if (!obj || typeof obj !== 'object') return 0
  if (Array.isArray(obj)) {
    return obj.reduce((sum, v) => sum + countBrowserPrefixedKeys(v), 0)
  }

  let total = 0

  for (const key of Object.keys(obj)) {
    if (key.includes(':')) total++
    total += countBrowserPrefixedKeys((obj as any)[key])
  }

  return total
}

export class BrowserSpecificFieldsPlugin {
  private readonly browser: DevOptions['browser']
  private readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  patchManifest(manifest: Manifest) {
    const patchedManifest = filterKeysForThisBrowser(manifest, this.browser)

    return JSON.stringify(patchedManifest, null, 2)
  }

  apply(compiler: Compiler): void {
    compiler.hooks.compilation.tap(
      'compatibility:browser-specific-fields',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'compatibility:browser-specific-fields',
            // One after PROCESS_ASSETS_STAGE_ADDITIONS, where
            // we first emit the manifest.json asset.
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
          },
          () => {
            const manifest = getManifestContent(compilation, this.manifestPath)
            const filteredCount = countBrowserPrefixedKeys(manifest)
            const patchedSource = this.patchManifest(manifest)
            const rawSource = new sources.RawSource(patchedSource)

            compilation.updateAsset('manifest.json', rawSource)

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.compatibilityManifestFilteredKeys(
                  this.browser,
                  filteredCount
                )
              )
            }
          }
        )
      }
    )
  }
}
