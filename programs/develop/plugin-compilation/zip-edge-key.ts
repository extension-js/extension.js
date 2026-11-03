// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {DevOptions} from '../types'

// Edge Add-ons refuses a package whose manifest carries `key` at all. The field
// stays in dist/edge, where it pins the unpacked id. Only the store zip loses it.
export function dropEdgeStoreKey<T extends object>(
  manifest: T,
  browser: DevOptions['browser']
): {manifest: T; dropped: boolean} {
  if (String(browser) !== 'edge') return {manifest, dropped: false}

  const source = manifest as Record<string, unknown>
  if (!('key' in source)) return {manifest, dropped: false}

  // Only the top-level key goes. Anything else the user wrote for Edge stays.
  const {key: _key, ...rest} = source

  return {manifest: rest as T, dropped: true}
}
