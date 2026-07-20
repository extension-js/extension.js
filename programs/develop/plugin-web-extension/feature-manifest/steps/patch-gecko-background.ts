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

// Firefox does not run MV3 background.service_worker: repoint background at the
// emitted bundle via scripts and drop the keys Firefox rejects. No-op otherwise.
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
