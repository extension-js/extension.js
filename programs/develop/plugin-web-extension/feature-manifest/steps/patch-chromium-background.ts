// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

// Chromium dropped background.page with Manifest V3 and has no translation
// for it: the extension installs with no load error and no background
// context at all, so the author's background code never runs. Gecko and
// WebKit still read the key on MV3, so only Chromium refuses.
export function hasUnsupportedMv3BackgroundPage(
  manifest: Manifest,
  browser: DevOptions['browser']
): boolean {
  if (!isChromiumBasedBrowser(String(browser))) return false
  if (Number(manifest.manifest_version) !== 3) return false

  const background = manifest.background as
    | {page?: unknown; service_worker?: unknown; scripts?: unknown}
    | undefined

  if (!background || typeof background.page !== 'string') return false
  if (!background.page.trim()) return false
  if (typeof background.service_worker === 'string') return false

  return !(Array.isArray(background.scripts) && background.scripts.length > 0)
}

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
