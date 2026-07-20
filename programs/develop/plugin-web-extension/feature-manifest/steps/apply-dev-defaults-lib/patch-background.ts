// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isGeckoBasedBrowser} from '../../../../lib/constants'
import type {DevOptions, Manifest} from '../../../../types'

// Dev-only: an MV2 event page (persistent: false) idles out and takes the
// control channel with it, so the dev manifest forces persistent on MV2.
function persistentPatchFor(manifest: Manifest): {persistent?: boolean} {
  return manifest.manifest_version === 3 ? {} : {persistent: true}
}

export default function patchBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  // background: {} must count as absent: dev always emits the reload-producer
  // worker, and passing the empty object through orphans it (no reloads).
  const bg = manifest.background as
    | {service_worker?: string; scripts?: string[]; page?: string}
    | undefined
  const hasRunnableEntry = Boolean(
    bg &&
      (bg.service_worker ||
        (Array.isArray(bg.scripts) && bg.scripts.length > 0) ||
        bg.page)
  )

  if (!hasRunnableEntry) {
    // Gecko family (firefox + forks like waterfox/librewolf, and the
    // gecko-based/firefox-based aliases) uses MV2 background.scripts.
    if (isGeckoBasedBrowser(String(browser))) {
      return {
        background: {
          ...(manifest.background || {}),
          scripts: ['background/script.js'],
          ...persistentPatchFor(manifest)
        }
      }
    }

    if (manifest.manifest_version === 2) {
      return {
        background: {
          ...(manifest.background || {}),
          scripts: ['background/script.js'],
          ...persistentPatchFor(manifest)
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
      ...manifest.background,
      ...persistentPatchFor(manifest)
    }
  }
}
