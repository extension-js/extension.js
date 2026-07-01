// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Manifest, DevOptions} from '../../../../types'
import {isGeckoBasedBrowser} from '../../../../lib/constants'

export default function patchBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  if (!manifest.background) {
    // Gecko family (firefox + forks like waterfox/librewolf, and the
    // gecko-based/firefox-based aliases) uses MV2 background.scripts.
    if (isGeckoBasedBrowser(String(browser))) {
      return {
        background: {
          ...(manifest.background || {}),
          scripts: ['background/script.js']
        }
      }
    }

    if (manifest.manifest_version === 2) {
      return {
        background: {
          ...(manifest.background || {}),
          scripts: ['background/script.js']
        }
      }
    }

    return {
      background: {
        ...(manifest.background || {}),
        service_worker: 'background/service_worker.js'
      }
    }
  }

  return {
    background: {
      ...manifest.background
    }
  }
}
