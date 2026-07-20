// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

// Chromium does not run MV3 background.scripts: repoint background at the
// emitted classic bundle via service_worker, drop the scripts key. No-op for Gecko/MV2.
export function patchChromiumBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  if (isGeckoBasedBrowser(String(browser))) return manifest
  if (Number(manifest.manifest_version) !== 3) return manifest

  const background = manifest.background as
    | {service_worker?: string; scripts?: string[]}
    | undefined

  if (!background || !Array.isArray(background.scripts)) {
    return manifest
  }

  // Chromium MV3 rejects the extension whenever background.scripts is present,
  // even beside a valid service_worker; drop scripts always.
  const {scripts, ...rest} = background

  return {
    ...manifest,
    background: {
      ...rest,
      service_worker:
        background.service_worker ||
        (scripts.length > 0 ? scripts[0] : undefined)
    }
  } as Manifest
}
