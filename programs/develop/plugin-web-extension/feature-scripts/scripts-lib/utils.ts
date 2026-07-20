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

    // TypeScript declaration files have no runtime code, but `path.extname`
    // reports them as `.ts`. Exclude them explicitly so a `.d.ts` sibling or a
    // `scripts/` folder declaration file is not treated as a script entry (swc
    // would then fail compiling an "ambient" implementation).
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
