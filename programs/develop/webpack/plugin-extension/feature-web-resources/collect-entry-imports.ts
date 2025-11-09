import type {Compilation} from '@rspack/core'
import type {FilepathList} from '../../webpack-types'
import {unixify} from '../feature-html/html-lib/paths'

type ChunkLike = {
  files?: string[]
  auxiliaryFiles?: string[]
}

type ModuleWithBuildInfo = {
  buildInfo?: {
    assets?: Map<string, unknown> | Record<string, unknown>
    assetsInfo?: Map<string, unknown> | Record<string, unknown>
  }
}

function forEachStringKey<T>(
  objectOrMap: Map<string, T> | Record<string, T> | undefined,
  callback: (key: string) => void
) {
  if (!objectOrMap) {
    return
  }

  if (objectOrMap instanceof Map) {
    const keys: IterableIterator<string> = objectOrMap.keys()

    for (const key of keys) {
      callback(String(key))
    }
  } else if (typeof objectOrMap === 'object') {
    const objectKeys: string[] = Object.keys(objectOrMap)
    for (const key of objectKeys) {
      callback(key)
    }
  }
}

function getAssetSource(compilation: Compilation, filename: string): string {
  let assetGetFunction: any = undefined
  if (typeof compilation.getAsset === 'function') {
    assetGetFunction = compilation.getAsset(filename)
  }

  let assetViaAssets: any = undefined

  if (!assetGetFunction && compilation.assets) {
    assetViaAssets = compilation.assets[filename]
  }

  const asset = assetGetFunction || assetViaAssets

  if (!asset) {
    return ''
  }

  let src: unknown = undefined

  if (typeof asset.source === 'function') {
    src = asset.source()
  } else if (asset.source?.source) {
    src = asset.source.source()
  } else {
    src = asset.source
  }

  if (typeof src === 'string') {
    return src
  }

  return ''
}

export function collectContentScriptEntryImports(
  compilation: Compilation,
  includeList?: FilepathList
): Record<string, string[]> {
  const entryImports: Record<string, string[]> = {}

  // Determine which entry names correspond to content scripts
  // based on includeList keys
  const contentEntryNames: string[] = []
  const includeListKeys: string[] = Object.keys(includeList || {})

  const filteredKeys: string[] = []
  for (let idx = 0; idx < includeListKeys.length; idx++) {
    const key = includeListKeys[idx]
    if (key) {
      filteredKeys.push(key)
    }
  }
  for (let idx = 0; idx < filteredKeys.length; idx++) {
    const entryKey = filteredKeys[idx]
    const isContentScript =
      typeof entryKey === 'string' && entryKey.startsWith('content_scripts')

    if (isContentScript) {
      if (Array.isArray(entryKey)) {
        const stringArr: string[] = entryKey as unknown as string[]

        for (let a = 0; a < stringArr.length; a++) {
          contentEntryNames.push(stringArr[a])
        }
      } else if (typeof entryKey === 'string') {
        contentEntryNames.push(entryKey)
      }
    }
  }

  const chunkGraph = compilation.chunkGraph

  // Also include any compilation entrypoints that match the logical
  // content_scripts prefix
  compilation.entrypoints.forEach((_entry, entryName) => {
    const entryNameString = String(entryName)
    const isContentScriptEntrypoint =
      entryNameString.startsWith('content_scripts/')
    const alreadyIncluded = contentEntryNames.includes(entryName)

    if (isContentScriptEntrypoint) {
      if (!alreadyIncluded) {
        contentEntryNames.push(entryName)
      }
    }
  })

  compilation.entrypoints.forEach((entry, entryName) => {
    if (!contentEntryNames.includes(entryName)) {
      return
    }

    const collectedFilesSet = new Set<string>()

    function addFileIfRelevant(file: string | undefined) {
      if (file === undefined || file === null) {
        return
      }

      const fileNameStr: string = String(file)
      const isJavaScript = fileNameStr.endsWith('.js')
      const isSourceMap = fileNameStr.endsWith('.map')

      if (isJavaScript || isSourceMap) {
        return
      }

      collectedFilesSet.add(fileNameStr)
    }

    // For each chunk in entry.chunks
    entry.chunks.forEach((chunk) => {
      // chunkFiles (primary files)
      const currentChunk = chunk as unknown as ChunkLike
      const chunkFilesArray: string[] = Array.isArray(currentChunk.files)
        ? currentChunk.files
        : []

      for (let i = 0; i < chunkFilesArray.length; i++) {
        addFileIfRelevant(chunkFilesArray[i])
      }

      // auxiliaryFiles
      let chunkAuxFilesArray: string[] = []

      if (Array.isArray(currentChunk.auxiliaryFiles)) {
        chunkAuxFilesArray = currentChunk.auxiliaryFiles
      }

      for (let i = 0; i < chunkAuxFilesArray.length; i++) {
        addFileIfRelevant(chunkAuxFilesArray[i])
      }

      // modules in chunk
      const modulesArray = Array.from(chunkGraph.getChunkModulesIterable(chunk))

      for (let j = 0; j < modulesArray.length; j++) {
        const moduleObj = modulesArray[j]

        // for each chunk that the module belongs to (auxiliary for module)
        const moduleChunksArray: any[] = Array.from(
          chunkGraph.getModuleChunks(moduleObj)
        )

        for (let k = 0; k < moduleChunksArray.length; k++) {
          const mk = moduleChunksArray[k] as unknown as ChunkLike
          const mkAuxFilesArr: string[] = Array.isArray(mk.auxiliaryFiles)
            ? mk.auxiliaryFiles
            : []

          for (let l = 0; l < mkAuxFilesArr.length; l++) {
            addFileIfRelevant(mkAuxFilesArr[l])
          }
        }

        const moduleWithBuildInfo = moduleObj as unknown as ModuleWithBuildInfo
        const buildInfo = moduleWithBuildInfo.buildInfo

        forEachStringKey(buildInfo?.assets, (key) => {
          addFileIfRelevant(key)
        })

        forEachStringKey(buildInfo?.assetsInfo, (key) => {
          addFileIfRelevant(key)
        })
      }

      // Fallback heuristic: scan JS chunk contents for references to emitted assets (e.g., assets/*.png)
      for (let i = 0; i < chunkFilesArray.length; i++) {
        const chunkFileName = chunkFilesArray[i]
        if (!String(chunkFileName).endsWith('.js')) {
          continue
        }

        const jsSource: string = getAssetSource(compilation, chunkFileName)

        if (!jsSource) {
          continue
        }

        const assetPattern = /assets\/[A-Za-z0-9._-]+/g
        const matchedStrings: string[] = jsSource.match(assetPattern) || []

        for (let m = 0; m < matchedStrings.length; m++) {
          addFileIfRelevant(matchedStrings[m])
        }
      }
    })

    // Extra fallback: directly scan the logical entry output (e.g., content_scripts/content-0.js)
    const logicalJsAssetName = `${entryName}.js`
    const logicalJsAssetSource = getAssetSource(compilation, logicalJsAssetName)

    if (logicalJsAssetSource) {
      const assetPattern = /assets\/[A-Za-z0-9._-]+/g
      const matchedStrings: string[] =
        logicalJsAssetSource.match(assetPattern) || []

      for (let n = 0; n < matchedStrings.length; n++) {
        addFileIfRelevant(matchedStrings[n])
      }
    }

    entryImports[entryName] = Array.from(collectedFilesSet)
  })

  // Normalize to unix path separators for consistency
  const entryImportsEntries = Object.entries(entryImports)

  for (let i = 0; i < entryImportsEntries.length; i++) {
    const name: string = entryImportsEntries[i][0]
    const files: string[] = entryImportsEntries[i][1]
    const normalizedFiles: string[] = []

    for (let j = 0; j < files.length; j++) {
      normalizedFiles.push(unixify(files[j]))
    }

    entryImports[name] = normalizedFiles
  }

  return entryImports
}
