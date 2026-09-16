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
import {dropMv2ObjectPolicy} from './mv2/content_security_policy'
import {dropMv2HostKeys} from './mv2/host_permissions'
import {manifestV3} from './mv3'

// projectPath finds the root public/ folder when the manifest lives in src/.
export function getManifestOverrides(
  manifestPath: string,
  manifest: Manifest,
  projectPath?: string
) {
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

  const common = manifestCommon(manifestContent, manifestPath, projectPath)
  const mv2 = manifestV2(manifestContent, manifestPath)
  const mv3 = manifestV3(manifestContent, manifestPath, projectPath)

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

  // MV2 folded its host lists into permissions and its CSP object into a
  // string above, and the source spread still carries the MV3 shapes.
  return JSON.stringify(dropMv2ObjectPolicy(dropMv2HostKeys(merged)), null, 2)
}
