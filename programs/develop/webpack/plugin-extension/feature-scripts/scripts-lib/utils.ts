import fs from 'fs'
import path from 'path'
import {shouldExclude} from '../../../lib/utils'
import {FilepathList} from '../../../types'

export function getScriptEntries(
  scriptPath: string | string[] | undefined,
  excludeList: FilepathList
) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile =
      fs.existsSync(scriptAsset) && !shouldExclude(scriptAsset, excludeList)

    const assetExtension = path.extname(scriptAsset)

    return validFile && scriptAsset?.includes(assetExtension)
  })

  return fileAssets
}

export function getCssEntries(
  scriptPath: string | string[] | undefined,
  excludeList: FilepathList
) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile =
      fs.existsSync(scriptAsset) && !shouldExclude(scriptAsset, excludeList)

    return (
      (validFile && scriptAsset.endsWith('.css')) ||
      scriptAsset.endsWith('.scss') ||
      scriptAsset.endsWith('.sass') ||
      scriptAsset.endsWith('.less')
    )
  })

  return fileAssets
}
export function getRelativePath(from: string, to: string) {
  let relativePath = path.relative(path.dirname(from), to)
  if (!relativePath.startsWith('.') && !relativePath.startsWith('..')) {
    relativePath = './' + relativePath
  }
  return relativePath
}
