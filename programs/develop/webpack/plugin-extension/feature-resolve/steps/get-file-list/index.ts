import path from 'path'
import {type FilepathList, type Manifest} from '../../../../webpack-types'
import {getManifestEntries} from './get-manifest-entries'
import * as utils from '../../../../lib/utils'
import {DevOptions} from '../../../../../commands/commands-lib/config-types'

function parseIncludeList(
  manifestPath: string,
  includeList?: FilepathList
): FilepathList {
  const manifestDir = path.dirname(manifestPath)

  const updatedIncludeList: FilepathList = Object.entries(
    includeList || {}
  ).reduce<FilepathList>((acc, [key, absolutePath]) => {
    const relativePath = path.relative(manifestDir, absolutePath as string)
    acc[key] = relativePath
    return acc
  }, {})

  return updatedIncludeList
}

function parseManifestList(
  manifestPath: string,
  browser: DevOptions['browser']
) {
  const manifest: Manifest = require(manifestPath)
  const patchedManifest = utils.filterKeysForThisBrowser(manifest, browser)
  const manifestIncludeList = getManifestEntries(patchedManifest)
  return manifestIncludeList
}

export function getFileList(
  manifestPath: string,
  browser: DevOptions['browser'],
  includeList?: FilepathList
) {
  const include = parseIncludeList(manifestPath, includeList)
  const manifestInclude = parseManifestList(manifestPath, browser)
  const filesList = {...include, ...manifestInclude}

  return filesList
}
