import path from 'path'
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
  const manifestContent: Manifest = manifest || require(manifestPath)
  const excludeRelative = exclude.map((excludePath) => {
    const context = path.dirname(manifestPath)
    const excludeRelative = excludePath.replace(context, '')
    return excludeRelative.startsWith('/')
      ? excludeRelative.slice(1)
      : excludeRelative
  })

  return JSON.stringify(
    {
      ...manifestContent,
      ...manifestCommon(manifestContent, excludeRelative),
      ...manifestV2(manifestContent, excludeRelative),
      ...manifestV3(manifestContent, excludeRelative)
    },
    null,
    2
  )
}
