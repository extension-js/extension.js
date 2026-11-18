// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../types'
import {getCanonicalContentScriptJsAssetName} from '../feature-scripts/contracts'
import type {ContentScriptsMeta} from './options'

// Which world each content-script bundle runs in, so the chunk loader can pick
// a loading strategy that world can actually use.
export function buildContentScriptsMeta(
  patchedManifest: Manifest
): ContentScriptsMeta {
  const contentScriptsMeta: ContentScriptsMeta = {}

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
