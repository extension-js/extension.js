// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

function isGeckoBrowser(browser: DevOptions['browser']): boolean {
  // Canonical classification covers firefox + forks (waterfox, librewolf) and
  // the gecko-based/firefox-based aliases. The previous substring check missed
  // waterfox/librewolf (neither contains a "firefox"/"gecko" substring).
  return isGeckoBasedBrowser(String(browser))
}

/**
 * Firefox does not run MV3 `background.service_worker` — it is disabled, and the
 * add-on fails to install ("background.service_worker is currently disabled. Add
 * background.scripts."). Firefox uses an event page via `background.scripts`.
 *
 * The user's background bundle is emitted regardless of target, so for Gecko
 * targets we repoint `background` at that emitted file via `scripts` and drop
 * the `service_worker`/`type` keys Firefox rejects. This keeps a single
 * `background.service_worker` source authoring cross-browser.
 *
 * No-op for Chromium, for manifests that already declare `background.scripts`,
 * and for manifests with no service worker.
 */
export function patchGeckoBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  if (!isGeckoBrowser(browser)) return manifest

  const background = manifest.background as
    | {service_worker?: string; scripts?: string[]; type?: string}
    | undefined

  if (!background || !background.service_worker || background.scripts) {
    return manifest
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {service_worker, type, ...rest} = background

  return {
    ...manifest,
    background: {...rest, scripts: [service_worker]}
  } as Manifest
}
