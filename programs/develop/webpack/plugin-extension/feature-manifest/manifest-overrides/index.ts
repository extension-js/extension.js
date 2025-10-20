import * as fs from 'fs'
import {manifestV2} from './mv2'
import {manifestV3} from './mv3'
import {manifestCommon} from './common'
import {type Manifest, type FilepathList} from '../../../webpack-types'

export function getManifestOverrides(
  manifestPath: string,
  manifest: Manifest,
  excludeList: FilepathList
) {
  // Load the manifest content from the manifestPath if not provided.
  const manifestContent: Manifest =
    manifest || JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  // Helper to omit a top-level key from a shallow object
  const omit = (obj: Record<string, any> | undefined, key: string) => {
    if (!obj) return {}
    const {[key]: _ignored, ...rest} = obj
    return rest
  }

  const common = manifestCommon(manifestContent, excludeList)
  const mv2 = manifestV2(manifestContent, excludeList)
  const mv3 = manifestV3(manifestContent, excludeList)

  // Deep-merge background so MV2 (scripts), MV3 (service_worker), and common (page)
  // contributions accumulate rather than overwrite each other.
  const backgroundMerged = {
    ...(manifestContent.background || {}),
    ...((common as any).background || {}),
    ...((mv2 as any).background || {}),
    ...((mv3 as any).background || {})
  }

  const merged: Record<string, any> = {
    ...manifestContent,
    ...omit(common as any, 'background'),
    ...omit(mv2 as any, 'background'),
    ...omit(mv3 as any, 'background')
  }

  if (Object.keys(backgroundMerged).length) {
    merged.background = backgroundMerged
  }

  return JSON.stringify(merged, null, 2)
}
