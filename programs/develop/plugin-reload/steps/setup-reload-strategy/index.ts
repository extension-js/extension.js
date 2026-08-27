// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {stripBom} from '../../../lib/parse-json-safe'
import {filterKeysForThisBrowser} from '../../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {getCanonicalContentScriptJsAssetName} from '../../../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {SetupBackgroundEntry} from './setup-background-entry'
import WebExtension from './webpack-target-webextension-fork'

// The background entry name the chunk-loading target keys its runtime off.
// Pure: it reads the manifest shape and nothing else, so both the dev reload
// strategy and the production chunk-loading target can share it.
export function getBackgroundEntryName(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  if (manifest.background) {
    if (isGeckoBasedBrowser(String(browser))) {
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

// Which world each content-script bundle runs in, so the chunk loader can pick
// a loading strategy that world can actually use.
export function buildContentScriptsMeta(
  patchedManifest: Manifest
): Record<string, unknown> {
  const contentScriptsMeta: Record<string, unknown> = {}
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
        const bridgeBundleId = getCanonicalContentScriptJsAssetName(bridgeIndex)
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
  return contentScriptsMeta
}

export class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler) {
    const manifest: Manifest = JSON.parse(
      stripBom(fs.readFileSync(this.manifestPath, 'utf-8'))
    )
    const patchedManifest = filterKeysForThisBrowser(manifest, this.browser)

    const contentScriptsMeta = buildContentScriptsMeta(patchedManifest)

    new SetupBackgroundEntry({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    new WebExtension({
      background: getBackgroundEntryName(patchedManifest, this.browser),
      hmrConfig: false,
      weakRuntimeCheck: true,
      contentScriptsMeta
    }).apply(
      compiler as Parameters<InstanceType<typeof WebExtension>['apply']>[0]
    )
  }
}
