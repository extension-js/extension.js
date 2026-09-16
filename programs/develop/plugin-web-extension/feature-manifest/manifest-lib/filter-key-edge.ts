// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {DevOptions, Manifest} from '../../../types'

/**
 * Edge Add-ons refuses a package whose manifest carries `key` at all, with
 * "The manifest shouldn't contain the key field". Partner Center assigns the
 * id instead, so the field has no purpose in an Edge package, and a build that
 * honors it produces a zip the store will not accept.
 *
 * A user reaches that state by writing `edge:key`, or `chromium:key` which
 * reaches every Chromium target, and nothing in the build said a word about
 * it. Only `chrome:key` was already safe, since 4.1.19 made that prefix vendor
 * exact and drops it on Edge.
 *
 * The caller runs this on PRODUCTION Edge builds only. A dev build keeps the
 * key, where a stable extension id is useful and no store is involved.
 */
export function dropEdgeStoreKey(
  manifest: Manifest,
  browser: DevOptions['browser']
): {manifest: Manifest; dropped: boolean} {
  if (String(browser) !== 'edge') return {manifest, dropped: false}

  const source = manifest as Record<string, unknown>
  if (!('key' in source)) return {manifest, dropped: false}

  // Only the top-level key goes. Anything else the user wrote for Edge stays.
  const {key: _key, ...rest} = source
  return {manifest: rest as Manifest, dropped: true}
}
