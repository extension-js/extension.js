// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isGeckoBasedBrowser} from '../../../../lib/constants'
import type {DevOptions, Manifest} from '../../../../types'

// Dev-only (§68): an MV2 event page (`persistent: false`) idles out ~20s into
// the session and takes the control channel with it — every act verb then
// fails "no executor connected" and the prescribed remedy (reload) needs the
// very executor that idled away. A dev session requires a live executor, so
// the dev manifest forces the background persistent on MV2. Production
// manifests are untouched; MV3 has no persistent key (invalid there).
function persistentPatchFor(manifest: Manifest): {persistent?: boolean} {
  return manifest.manifest_version === 3 ? {} : {persistent: true}
}

export default function patchBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  // A `background` key with no runnable entry (`background: {}` in the wild)
  // must count as absent: dev always emits the reload-producer service worker,
  // and passing the empty object through leaves that emitted worker orphaned,
  // Chrome loads no background, no producer connects, and reload delivery is
  // silently dead for the whole session.
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
