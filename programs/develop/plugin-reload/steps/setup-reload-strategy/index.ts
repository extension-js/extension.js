// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import * as fs from 'fs'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {stripBom} from '../../../lib/parse-json-safe'
import {filterKeysForThisBrowser} from '../../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {getCanonicalContentScriptJsAssetName} from '../../../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {SetupBackgroundEntry} from './setup-background-entry'
import WebExtension from './webpack-target-webextension-fork'

export class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private getEntryName(manifest: Manifest) {
    if (manifest.background) {
      if (isGeckoBasedBrowser(String(this.browser))) {
        return {
          pageEntry: 'background/script',
          tryCatchWrapper: true,
          eagerChunkLoading: false
        }
      }

      if (manifest.manifest_version === 3) {
        return {
          serviceWorkerEntry: 'background/service_worker',
          tryCatchWrapper: true,
          eagerChunkLoading: false
        }
      }

      if (manifest.manifest_version === 2) {
        return {
          pageEntry: 'background/script',
          tryCatchWrapper: true,
          eagerChunkLoading: false
        }
      }
    }

    return {
      pageEntry: 'background',
      tryCatchWrapper: true,
      eagerChunkLoading: false
    }
  }

  public apply(compiler: Compiler) {
    const manifest: Manifest = JSON.parse(
      stripBom(fs.readFileSync(this.manifestPath, 'utf-8'))
    )
    const patchedManifest = filterKeysForThisBrowser(manifest, this.browser)

    const contentScriptsMeta: Record<string, any> = {}
    try {
      const csList = Array.isArray(patchedManifest.content_scripts)
        ? patchedManifest.content_scripts
        : []
      const originalCount = csList.length
      let bridgeOrdinal = 0
      for (let i = 0; i < csList.length; i++) {
        const cs = csList[i]
        const bundleId = getCanonicalContentScriptJsAssetName(i)
        const isMain = cs?.world === 'MAIN'
        if (isMain) {
          const bridgeIndex = originalCount + bridgeOrdinal++
          const bridgeBundleId =
            getCanonicalContentScriptJsAssetName(bridgeIndex)
          contentScriptsMeta[bundleId] = {
            index: i,
            bundleId,
            world: 'main',
            bridgeBundleId
          }
          contentScriptsMeta[bridgeBundleId] = {
            index: bridgeIndex,
            bundleId: bridgeBundleId,
            world: 'extension',
            role: 'main_world_bridge',
            mainBundleId: bundleId
          }
        } else {
          contentScriptsMeta[bundleId] = {
            index: i,
            bundleId,
            world: 'extension'
          }
        }
      }
    } catch {
      // ignore - runtime has safe defaults
    }

    new SetupBackgroundEntry({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    new WebExtension({
      background: this.getEntryName(patchedManifest),
      hmrConfig: false,
      weakRuntimeCheck: true,
      contentScriptsMeta
    }).apply(compiler as any)
  }
}
