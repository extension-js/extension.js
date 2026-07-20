// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {stripBom} from '../../../lib/parse-json-safe'
import type {Manifest} from '../../../types'
import {manifestCommon} from './common'
import {manifestV2} from './mv2'
import {manifestV3} from './mv3'

export function getManifestOverrides(manifestPath: string, manifest: Manifest) {
  const manifestContent: Manifest =
    manifest || JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8')))

  const omit = (obj: Record<string, unknown> | undefined, key: string) => {
    if (!obj) return {}
    const {[key]: _ignored, ...rest} = obj
    return rest
  }

  // Each aggregator's `background` contribution is absent or a {background: {...}}
  // object; read it as a shallow record without an `as any` escape.
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

  const merged: Record<string, unknown> = {
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
