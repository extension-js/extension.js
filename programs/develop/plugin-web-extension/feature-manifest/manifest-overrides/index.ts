// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {manifestV2} from './mv2'
import {manifestV3} from './mv3'
import {manifestCommon} from './common'
import {type Manifest} from '../../../types'

export function getManifestOverrides(manifestPath: string, manifest: Manifest) {
  // Load the manifest content from the manifestPath if not provided.
  const manifestContent: Manifest =
    manifest || JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  // Helper to omit a top-level key from a shallow object
  const omit = (obj: Record<string, unknown> | undefined, key: string) => {
    if (!obj) return {}
    const {[key]: _ignored, ...rest} = obj
    return rest
  }

  // Each manifest-overrides aggregator returns a plain object whose `background`
  // contribution is either absent or a `{background: {...}}` object. This reads
  // that contribution as a shallow record without an `as any` escape.
  const pickBackground = (
    obj: Record<string, unknown>
  ): Record<string, unknown> => {
    const value = obj.background
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {}
  }

  const common = manifestCommon(manifestContent, manifestPath)
  const mv2 = manifestV2(manifestContent)
  const mv3 = manifestV3(manifestContent)

  // Deep-merge background so MV2 (scripts), MV3 (service_worker), and common (page)
  // contributions accumulate rather than overwrite each other.
  const backgroundMerged = {
    ...(manifestContent.background || {}),
    ...pickBackground(common),
    ...pickBackground(mv2),
    ...pickBackground(mv3)
  }

  const merged: Record<string, any> = {
    ...manifestContent,
    ...omit(common, 'background'),
    ...omit(mv2, 'background'),
    ...omit(mv3, 'background')
  }

  if (Object.keys(backgroundMerged).length) {
    merged.background = backgroundMerged
  }

  return JSON.stringify(merged, null, 2)
}
