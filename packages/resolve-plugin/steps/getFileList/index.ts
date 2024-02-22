import path from 'path'
import {type IncludeList, type Manifest} from '../../types'
import getManifestEntries from './getManifestEntries'

function parseIncludeList(
  manifestPath: string,
  includeList?: IncludeList
): IncludeList {
  const manifestDir = path.dirname(manifestPath)

  const updatedIncludeList: IncludeList = Object.entries(
    includeList || {}
  ).reduce<IncludeList>((acc, [key, absolutePath]) => {
    const relativePath = path.relative(manifestDir, absolutePath)
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

export default function getFileList(
  manifestPath: string,
  includeList?: IncludeList
) {
  const include = parseIncludeList(manifestPath, includeList)
  const manifestInclude = parseManifestList(manifestPath)
  const filesList = {...include, ...manifestInclude}

  return filesList
}
