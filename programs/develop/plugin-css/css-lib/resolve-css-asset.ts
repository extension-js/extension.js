//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation} from '@rspack/core'

export interface CssAssetResult {
  found: boolean
  // The public href for the injected <link> when the asset name differs from the
  // canonical <feature>.css; undefined when the canonical name matched.
  href: string | undefined
}

/**
 * Resolves the CSS asset emitted for a given entry feature.
 *
 * First tries the canonical name (`<feature>.css`).  If that misses,
 * which can happen when rspack's native CSS (`experiments.css`) splits
 * the stylesheet into a chunk whose name differs from the entry, it
 * falls back to inspecting the entrypoint's actual chunk files.
 */
export function resolveCssAsset(
  compilation: Compilation,
  feature: string
): CssAssetResult {
  if (compilation.getAsset(`${feature}.css`)) {
    return {found: true, href: undefined}
  }

  const entrypoint = compilation.entrypoints?.get(feature)
  if (entrypoint) {
    for (const chunk of entrypoint.chunks) {
      for (const file of chunk.files) {
        if (file.endsWith('.css')) {
          return {found: true, href: `/${file}`}
        }
      }
    }
  }

  return {found: false, href: undefined}
}
