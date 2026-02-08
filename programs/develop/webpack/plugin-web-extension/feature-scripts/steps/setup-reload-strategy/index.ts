// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import WebExtension from './webpack-target-webextension-fork'
import {filterKeysForThisBrowser} from '../../scripts-lib/manifest'
import {SetupBackgroundEntry} from './setup-background-entry'
import {ApplyManifestDevDefaults} from './apply-manifest-dev-defaults'
import type {
  Manifest,
  PluginInterface,
  DevOptions
} from '../../../../webpack-types'

export class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private getEntryName(manifest: Manifest) {
    if (manifest.background) {
      if (this.browser === 'firefox' || this.browser === 'gecko-based') {
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
    // Guards are handled at the root plugin level

    const manifest: Manifest = JSON.parse(
      fs.readFileSync(this.manifestPath, 'utf-8')
    )
    const patchedManifest = filterKeysForThisBrowser(manifest, this.browser)

    // Build metadata for content scripts so the chunk loader runtime can be
    // world-aware (MAIN vs isolated) and can route MAIN-world chunk loading
    // through an isolated bridge.
    const contentScriptsMeta: Record<string, any> = {}
    try {
      const csList: any[] = Array.isArray(patchedManifest.content_scripts)
        ? (patchedManifest.content_scripts as any[])
        : []
      const originalCount = csList.length
      let bridgeOrdinal = 0
      for (let i = 0; i < csList.length; i++) {
        const cs = csList[i]
        const bundleId = `content_scripts/content-${i}.js`
        const isMain = cs?.world === 'MAIN'
        if (isMain) {
          const bridgeIndex = originalCount + bridgeOrdinal++
          contentScriptsMeta[bundleId] = {
            index: i,
            bundleId,
            world: 'main',
            bridgeBundleId: `content_scripts/content-${bridgeIndex}.js`
          }
          // also describe the bridge bundle
          const bridgeBundleId = `content_scripts/content-${bridgeIndex}.js`
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
      // ignore – safe defaults in runtime
    }

    // 1 - Apply the manifest defaults needed
    // for webpack-target-webextension to work correctly
    new ApplyManifestDevDefaults({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 3 - Setup the background entry needed for webpack-target-webextension
    new SetupBackgroundEntry({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 4 - Now that we know the background exists, add the web extension target.
    new WebExtension({
      background: this.getEntryName(patchedManifest),
      weakRuntimeCheck: true,
      contentScriptsMeta
    }).apply(compiler as any)
  }
}
