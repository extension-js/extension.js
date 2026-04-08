//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type Compilation} from '@rspack/core'

export interface CssAssetResult {
  /** Whether a CSS asset was found for this feature. */
  found: boolean
  /**
   * When the asset lives under a name that differs from the canonical
   * `<feature>.css` (e.g. a chunk split by rspack's native CSS), this
   * holds the public href to use in the injected `<link>` tag.
   * Undefined when the canonical name matched directly.
   */
  href: string | undefined
}

/**
 * Resolves the CSS asset emitted for a given entry feature.
 *
 * First tries the canonical name (`<feature>.css`).  If that misses —
 * which can happen when rspack's native CSS (`experiments.css`) splits
 * the stylesheet into a chunk whose name differs from the entry — it
 * falls back to inspecting the entrypoint's actual chunk files.
 */
export function resolveCssAsset(
  compilation: Compilation,
  feature: string
): CssAssetResult {
  // Fast path: canonical asset name
  if (compilation.getAsset(feature + '.css')) {
    return {found: true, href: undefined}
  }

  // Slow path: walk entrypoint chunks for any emitted .css file
  const entrypoint = compilation.entrypoints?.get(feature)
  if (entrypoint) {
    for (const chunk of entrypoint.chunks) {
      for (const file of chunk.files) {
        if (file.endsWith('.css')) {
          return {found: true, href: '/' + file}
        }
      }
    }
  }

  return {found: false, href: undefined}
}
