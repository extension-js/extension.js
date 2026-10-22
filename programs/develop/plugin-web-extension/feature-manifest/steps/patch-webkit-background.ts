// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isWebkitBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

type WebkitBackground = {
  service_worker?: string
  scripts?: string[]
  type?: string
  persistent?: boolean
}

// Safari never starts an MV3 background.service_worker: the worker is not even
// listed under Develop, so logs, the control bridge and reload all go missing
// with nothing printed. Measured on Safari 26.5.2 against extensions built by
// Apple's own converter, so it is not something our bundle causes.
// A non-persistent background page runs the same emitted bundle.
//
// No `persistent` key on any path: Manifest V3 background scripts are
// non-persistent by definition, and Safari 27's converter rejects the key
// whatever its value. A manifest already in scripts form, or one whose
// `safari:` or `gecko:` prefix resolved to scripts, carried it through until
// the author stripped it by hand.
export function patchWebkitBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  if (!isWebkitBasedBrowser(String(browser))) return manifest

  const background = manifest.background as WebkitBackground | undefined

  if (!background) return manifest

  if (!background.service_worker || background.scripts) {
    if (!('persistent' in background)) return manifest

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {persistent, ...rest} = background

    return {...manifest, background: rest} as Manifest
  }

  // `type` describes a worker, and the page loads the same bundle as a classic
  // script, so it goes with the key it belonged to.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {service_worker, type, persistent, ...rest} = background

  return {
    ...manifest,
    background: {...rest, scripts: [service_worker]}
  } as Manifest
}
