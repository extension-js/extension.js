// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
export function getScriptEntries(scriptPath: string | string[] | undefined) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile = fs.existsSync(scriptAsset)

    // .d.ts files have no runtime code but path.extname reports .ts; exclude them
    // so declaration files are not treated as script entries (swc would fail).
    if (/\.d\.[cm]?ts$/i.test(scriptAsset)) return false

    const assetExtension = path.extname(scriptAsset)

    return (
      validFile &&
      (assetExtension === '.js' ||
        assetExtension === '.cjs' ||
        assetExtension === '.mjs' ||
        assetExtension === '.jsx' ||
        assetExtension === '.mjsx' ||
        assetExtension === '.ts' ||
        assetExtension === '.mts' ||
        assetExtension === '.mtsx' ||
        assetExtension === '.tsx')
    )
  })

  return fileAssets
}

export function getCssEntries(scriptPath: string | string[] | undefined) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile = fs.existsSync(scriptAsset)

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
