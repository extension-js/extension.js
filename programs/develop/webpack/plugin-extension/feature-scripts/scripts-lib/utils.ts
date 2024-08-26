import fs from 'fs'
import path from 'path'
import {FilepathList} from '../../../webpack-types'
import * as utils from '../../../lib/utils'

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
      fs.existsSync(scriptAsset) &&
      !utils.shouldExclude(scriptAsset, excludeList)

    const assetExtension = path.extname(scriptAsset)

    return (
      validFile &&
      (assetExtension === '.js' ||
        assetExtension === '.mjs' ||
        assetExtension === '.jsx' ||
        assetExtension === '.ts' ||
        assetExtension === '.tsx')
    )
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
      fs.existsSync(scriptAsset) &&
      !utils.shouldExclude(scriptAsset, excludeList)

    return (
      validFile &&
      (scriptAsset.endsWith('.css') ||
        scriptAsset.endsWith('.scss') ||
        scriptAsset.endsWith('.sass') ||
        scriptAsset.endsWith('.less'))
    )
  })

  return fileAssets
}
