// ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗      ██████╗  █████╗ ████████╗██╗  ██╗███████╗
// ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║      ██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██╔════╝
// ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║█████╗██████╔╝███████║   ██║   ███████║███████╗
// ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║╚════╝██╔═══╝ ██╔══██║   ██║   ██╔══██║╚════██║
// ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║      ██║     ██║  ██║   ██║   ██║  ██║███████║
// ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation} from '@rspack/core'
import {sources} from '@rspack/core'

// The devtool wrote <asset>.map before the report stage. A step that then
// prepends runtime text to the asset must pad that map by the same number
// of lines, or every mapped line in the file points one prefix too high.
export function prependToEmittedAsset(
  compilation: Pick<Compilation, 'updateAsset'> &
    Partial<Pick<Compilation, 'getAsset'>>,
  asset: {name: string; source: {source(): string | Buffer}},
  prefix: string
): void {
  const assetName = asset.name
  const original = asset.source.source().toString()
  compilation.updateAsset(
    assetName,
    new sources.RawSource(`${prefix}${original}`)
  )

  const mapAsset =
    typeof compilation.getAsset === 'function'
      ? compilation.getAsset(`${assetName}.map`)
      : undefined
  if (!mapAsset) return
  const prefixLines = prefix.split('\n').length - 1
  if (prefixLines <= 0) return
  try {
    const map = JSON.parse(mapAsset.source.source().toString()) as {
      mappings?: string
    }
    if (typeof map.mappings !== 'string') return
    map.mappings = `${';'.repeat(prefixLines)}${map.mappings}`
    compilation.updateAsset(
      `${assetName}.map`,
      new sources.RawSource(JSON.stringify(map))
    )
  } catch {
    // A map the devtool did not write as JSON is left alone.
  }
}
