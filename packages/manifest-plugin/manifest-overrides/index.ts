// import fs from 'fs'
import manifestCommon from './common'
import manifestV2 from './mv2'
import manifestV3 from './mv3'
import {type Manifest} from '../types'

export default function getManifestOverrides(
  manifestPath: string,
  manifest?: Manifest,
  exclude: string[] = []
) {
  // In case user don't provide a manifest content,
  // we will try to load it from the manifestPath.
  const manifestContent = manifest || require(manifestPath)

  return JSON.stringify(
    {
      ...manifestContent,
      ...manifestCommon(manifestContent, exclude),
      ...manifestV2(manifestContent, exclude),
      ...manifestV3(manifestContent, exclude)
    },
    null,
    2
  )
}
