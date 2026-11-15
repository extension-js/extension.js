// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

function isGeckoBrowser(browser: DevOptions['browser']): boolean {
  // Canonical classification covers firefox + forks and the gecko-based aliases;
  // the previous substring check missed waterfox/librewolf.
  return isGeckoBasedBrowser(String(browser))
}

// Firefox starts an empty generated background page for an empty scripts
// list, where Chromium and Safari start no background at all.
export function hasEmptyGeckoBackgroundScripts(
  manifest: Manifest,
  browser: DevOptions['browser']
): boolean {
  if (!isGeckoBrowser(browser)) return false

  const background = manifest.background as {scripts?: unknown} | undefined

  return Array.isArray(background?.scripts) && background.scripts.length === 0
}

// Firefox does not run MV3 background.service_worker: repoint background at the
// emitted bundle via scripts and drop the keys Firefox rejects. No-op otherwise.
export function patchGeckoBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  if (!isGeckoBrowser(browser)) return manifest

  let background = manifest.background as
    | {
        service_worker?: string
        scripts?: string[]
        type?: string
        page?: string
      }
    | undefined

  if (!background) return manifest

  const hadEmptyScripts = hasEmptyGeckoBackgroundScripts(manifest, browser)

  if (hadEmptyScripts) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {scripts, ...kept} = background
    background = kept
  }

  if (!background.service_worker || background.scripts) {
    if (!hadEmptyScripts) return manifest
    if (background.page) return {...manifest, background} as Manifest

    // Nothing left names a background, so the key itself goes.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {background: dropped, ...rest} = manifest as Record<string, unknown>

    return rest as Manifest
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {service_worker, type, ...rest} = background

  return {
    ...manifest,
    background: {...rest, scripts: [service_worker]}
  } as Manifest
}
