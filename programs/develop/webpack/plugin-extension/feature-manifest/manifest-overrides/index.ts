import path from 'path'
import {manifestV2} from './mv2'
import {manifestV3} from './mv3'
import {manifestCommon} from './common'
import {type Manifest, type FilepathList} from '../../../types'

export function getManifestOverrides(
  manifestPath: string,
  manifest: Manifest,
  excludeList: FilepathList
) {
  // Load the manifest content from the manifestPath if not provided.
  const manifestContent: Manifest = manifest || require(manifestPath)

  // Function to handle different types of excludePath (string, array of strings, or undefined).
  const processExcludePath = (
    excludePath: string | string[] | undefined
  ): string[] => {
    if (Array.isArray(excludePath)) {
      return excludePath.map((ep) => processSingleExcludePath(ep))
    } else if (typeof excludePath === 'string') {
      return [processSingleExcludePath(excludePath)]
    } else {
      return []
    }
  }

  const processSingleExcludePath = (excludePath: string): string => {
    const context = path.dirname(manifestPath)
    const excludeRelative = excludePath.replace(context, '')
    return excludeRelative.startsWith('/')
      ? excludeRelative.slice(1)
      : excludeRelative
  }

  const excludeRelative = Object.entries(excludeList).flatMap(
    ([, excludePath]) => processExcludePath(excludePath)
  )

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
