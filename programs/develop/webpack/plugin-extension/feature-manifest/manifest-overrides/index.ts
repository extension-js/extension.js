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
  const manifestContent: Manifest = manifest || require(manifestPath)

  return JSON.stringify(
    {
      ...manifestContent,
      ...manifestCommon(manifestContent, excludeList),
      ...manifestV2(manifestContent, excludeList),
      ...manifestV3(manifestContent, excludeList)
    },
    null,
    2
  )
}
