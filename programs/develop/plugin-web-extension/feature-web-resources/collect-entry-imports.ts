// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compilation} from '@rspack/core'
import type {FilepathList} from '../../types'
import {unixify} from '../shared/paths'

type ChunkLike = {
  files?: Iterable<string>
  auxiliaryFiles?: Iterable<string>
}

// Rspack exposes chunk.files/auxiliaryFiles as ReadonlySet, webpack as
// arrays. Normalize both so the chunk walk runs against either bundler.
function toFileArray(value: Iterable<string> | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : Array.from(value)
}

// Slash-joined segments so nested emits like assets/fonts/x.woff2 match whole,
// while quotes, parens, and whitespace still terminate the reference.
export const EMITTED_ASSET_REF_PATTERN =
  /assets\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g

function isExcludedFromWar(fileName: string) {
  const name = String(fileName || '')
  if (!name || name === 'manifest.json') return true
  if (name.endsWith('.js') || name.endsWith('.map')) return true
  if (/(^|\/)hot\//.test(name)) return true
  return false
}

export function listEmittedAssetNames(compilation: Compilation): string[] {
  if (typeof compilation.getAssets === 'function') {
    try {
      return compilation.getAssets().map((asset) => String(asset.name))
    } catch {
      // Fall through to compilation.assets
    }
  }
  return Object.keys(compilation.assets || {})
}

// Content scripts load hashed wasm cores and model weights from the output
// root via getURL / new URL / the bundler public path. Matching only
// assets/ silently drops those payloads from web_accessible_resources.
export function collectReferencedRuntimePayloads(
  source: string,
  emittedAssetNames: string[]
): string[] {
  if (!source) return []

  const found = new Set<string>()

  const patternHits: string[] = source.match(EMITTED_ASSET_REF_PATTERN) || []
  for (const hit of patternHits) {
    if (!isExcludedFromWar(hit)) found.add(hit)
  }

  const eligible = emittedAssetNames
    .filter((name) => !isExcludedFromWar(name))
    .sort((a, b) => b.length - a.length)

  for (const asset of eligible) {
    if (source.includes(asset)) {
      found.add(unixify(asset))
    }
  }

  return Array.from(found)
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
  let assetGetFunction: unknown
  if (typeof compilation.getAsset === 'function') {
    assetGetFunction = compilation.getAsset(filename)
  }

  let assetViaAssets: unknown

  if (!assetGetFunction && compilation.assets) {
    assetViaAssets = compilation.assets[filename]
  }

  const asset = (assetGetFunction || assetViaAssets) as
    | {source?: {source?: () => unknown} | (() => unknown)}
    | undefined

  if (!asset) {
    return ''
  }

  let src: unknown

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

type ChunkGroupLike = {
  chunks?: Iterable<unknown>
  getChildren?: () => Iterable<ChunkGroupLike>
}

type ChunkWithAsync = ChunkLike & {
  getAllAsyncChunks?: () => Iterable<ChunkLike>
}

// The JavaScript chunks a content script loads on demand through import().
// They are not initial chunks, so the entry walk above never sees them, and
// Chrome refuses to load them from a page unless the manifest lists them.
export function collectContentScriptAsyncChunkFiles(
  compilation: Compilation
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  // Minimal compilations in unit specs carry no entrypoints map.
  if (typeof compilation.entrypoints?.forEach !== 'function') return result

  compilation.entrypoints.forEach((entry, entryName) => {
    if (!String(entryName).startsWith('content_scripts/')) return

    const initial = new Set<string>()
    for (const chunk of toFileArray(
      (entry as unknown as ChunkGroupLike).chunks as Iterable<string>
    )) {
      for (const file of toFileArray((chunk as unknown as ChunkLike).files)) {
        initial.add(file)
      }
    }

    const asyncFiles = new Set<string>()
    const visitChunk = (chunk: ChunkLike) => {
      for (const file of toFileArray(chunk.files)) {
        if (!file.endsWith('.js') || initial.has(file)) continue
        asyncFiles.add(unixify(file))
      }
    }
    for (const chunk of toFileArray(
      (entry as unknown as ChunkGroupLike).chunks as Iterable<string>
    )) {
      const withAsync = chunk as unknown as ChunkWithAsync
      if (typeof withAsync.getAllAsyncChunks === 'function') {
        for (const asyncChunk of withAsync.getAllAsyncChunks()) {
          visitChunk(asyncChunk)
        }
      }
    }
    // Chunk groups reached through children cover bundlers without
    // getAllAsyncChunks on the chunk itself.
    const seenGroups = new Set<ChunkGroupLike>()
    const visitGroup = (group: ChunkGroupLike) => {
      if (seenGroups.has(group)) return
      seenGroups.add(group)
      for (const chunk of toFileArray(group.chunks as Iterable<string>)) {
        visitChunk(chunk as unknown as ChunkLike)
      }
      if (typeof group.getChildren === 'function') {
        for (const child of group.getChildren()) visitGroup(child)
      }
    }
    if (
      typeof (entry as unknown as ChunkGroupLike).getChildren === 'function'
    ) {
      for (const child of (
        entry as unknown as ChunkGroupLike
      ).getChildren?.() || []) {
        visitGroup(child)
      }
    }

    if (asyncFiles.size > 0) result[entryName] = Array.from(asyncFiles).sort()
  })

  return result
}

export function collectContentScriptEntryImports(
  compilation: Compilation,
  includeList?: FilepathList
): Record<string, string[]> {
  const entryImports: Record<string, string[]> = {}

  const contentEntryNames = new Set<string>(
    Object.keys(includeList || {}).filter((k) =>
      k.startsWith('content_scripts')
    )
  )

  const chunkGraph = compilation.chunkGraph

  compilation.entrypoints.forEach((_entry, entryName) => {
    if (String(entryName).startsWith('content_scripts/')) {
      contentEntryNames.add(entryName)
    }
  })

  compilation.entrypoints.forEach((entry, entryName) => {
    if (!contentEntryNames.has(entryName)) {
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

    entry.chunks.forEach((chunk) => {
      const currentChunk = chunk as unknown as ChunkLike
      const chunkFilesArray: string[] = toFileArray(currentChunk.files)

      for (let i = 0; i < chunkFilesArray.length; i++) {
        addFileIfRelevant(chunkFilesArray[i])
      }

      const chunkAuxFilesArray: string[] = toFileArray(
        currentChunk.auxiliaryFiles
      )

      for (let i = 0; i < chunkAuxFilesArray.length; i++) {
        addFileIfRelevant(chunkAuxFilesArray[i])
      }

      const modulesArray = Array.from(chunkGraph.getChunkModulesIterable(chunk))

      for (let j = 0; j < modulesArray.length; j++) {
        const moduleObj = modulesArray[j]

        const moduleChunksArray: unknown[] = Array.from(
          chunkGraph.getModuleChunks(moduleObj)
        )

        for (let k = 0; k < moduleChunksArray.length; k++) {
          const mk = moduleChunksArray[k] as unknown as ChunkLike
          const mkAuxFilesArr: string[] = toFileArray(mk.auxiliaryFiles)

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

      // Fallback heuristic: scan JS chunk contents for referenced emits
      // (assets/* plus root-level wasm cores / model weights).
      const emittedAssetNames = listEmittedAssetNames(compilation)

      for (let i = 0; i < chunkFilesArray.length; i++) {
        const chunkFileName = chunkFilesArray[i]
        if (!String(chunkFileName).endsWith('.js')) {
          continue
        }

        const jsSource: string = getAssetSource(compilation, chunkFileName)

        if (!jsSource) {
          continue
        }

        const referenced = collectReferencedRuntimePayloads(
          jsSource,
          emittedAssetNames
        )

        for (let m = 0; m < referenced.length; m++) {
          addFileIfRelevant(referenced[m])
        }
      }
    })

    // Extra fallback: directly scan the logical entry output (e.g., content_scripts/content-0.js)
    const logicalJsAssetName = `${entryName}.js`
    const logicalJsAssetSource = getAssetSource(compilation, logicalJsAssetName)

    if (logicalJsAssetSource) {
      const referenced = collectReferencedRuntimePayloads(
        logicalJsAssetSource,
        listEmittedAssetNames(compilation)
      )

      for (let n = 0; n < referenced.length; n++) {
        addFileIfRelevant(referenced[n])
      }
    }

    entryImports[entryName] = Array.from(collectedFilesSet)
  })

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
