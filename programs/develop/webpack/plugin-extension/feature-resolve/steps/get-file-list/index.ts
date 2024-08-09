import path from 'path'
import {type FilepathList, type Manifest} from '../../../../webpack-types'
import {getManifestEntries} from './get-manifest-entries'

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

function parseManifestList(manifestPath: string) {
  const manifest: Manifest = require(manifestPath)
  const manifestIncludeList = getManifestEntries(manifest)
  return manifestIncludeList
}

export function getFileList(manifestPath: string, includeList?: FilepathList) {
  const include = parseIncludeList(manifestPath, includeList)
  const manifestInclude = parseManifestList(manifestPath)
  const filesList = {...include, ...manifestInclude}

  return filesList
}
