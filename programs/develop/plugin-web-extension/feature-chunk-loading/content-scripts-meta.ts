// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../types'
import {
  getCanonicalContentScriptJsAssetName,
  mainWorldBridgeIndexes
} from '../feature-scripts/contracts'
import type {ContentScriptsMeta} from './options'

// Which world each content-script bundle runs in, so the chunk loader can pick
// a loading strategy that world can actually use.
export function buildContentScriptsMeta(
  patchedManifest: Manifest
): ContentScriptsMeta {
  const contentScriptsMeta: ContentScriptsMeta = {}

  const csList = Array.isArray(patchedManifest.content_scripts)
    ? patchedManifest.content_scripts
    : []
  const bridgeOf = new Map(
    mainWorldBridgeIndexes(csList).map(({mainIndex, bridgeIndex}) => [
      mainIndex,
      bridgeIndex
    ])
  )

  for (let i = 0; i < csList.length; i++) {
    const bundleId = getCanonicalContentScriptJsAssetName(i)
    const bridgeIndex = bridgeOf.get(i)

    if (bridgeIndex !== undefined) {
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
        world: csList[i]?.world === 'MAIN' ? 'main' : 'extension'
      }
    }
  }

  return contentScriptsMeta
}
