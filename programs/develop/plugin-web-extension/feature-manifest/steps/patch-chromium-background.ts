// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

/**
 * Chromium does not run MV3 `background.scripts` — the extension fails to load
 * ("The 'background.scripts' key cannot be used with manifest_version 3"),
 * while Firefox happily uses it as an event page. The mirror of
 * patch-gecko-background: the scripts array is bundled into a single classic
 * file regardless of target, so for Chromium-family MV3 targets we repoint
 * `background` at that emitted bundle via `service_worker` and drop the
 * `scripts` key Chromium rejects. The bundle is classic (no `type: module`),
 * which a classic service worker runs as-is.
 *
 * No-op for Gecko targets, MV2, manifests that already declare a
 * `background.service_worker`, and manifests with no scripts array.
 */
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

  // Chromium MV3 rejects the extension whenever `background.scripts` is
  // present — even alongside a valid `service_worker` (cross-browser hybrid
  // manifests declare both). Drop `scripts` always; when it was the only
  // entry, repoint `service_worker` at the emitted classic bundle.
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
