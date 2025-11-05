import type {Compilation} from '@rspack/core'
import type {FilepathList} from '../../webpack-types'
import {unixify} from '../../webpack-lib/paths'

export function collectContentScriptEntryImports(
  compilation: Compilation,
  includeList?: FilepathList
): Record<string, string[]> {
  const entryImports: Record<string, string[]> = {}

  // Determine which entry names correspond to content
  // cripts based on includeList keys
  const contentEntries: string[] = []
  const entryNames = Object.keys(includeList || {})

  for (const key of entryNames.filter(Boolean)) {
    if (key.startsWith('content_scripts')) {
      if (Array.isArray(key)) {
        contentEntries.push(...(key as unknown as string[]))
      } else if (typeof key === 'string') {
        contentEntries.push(key)
      }
    }
  }

  const chunkGraph = compilation.chunkGraph

  compilation.entrypoints.forEach((entry, entryName) => {
    if (!contentEntries.includes(entryName)) return
    const importedFiles: string[] = []

    entry.chunks.forEach((chunk) => {
      const modules = Array.from(chunkGraph.getChunkModulesIterable(chunk))

      modules.forEach((module) => {
        for (const moduleChunk of chunkGraph.getModuleChunks(module)) {
          for (const file of moduleChunk.auxiliaryFiles) {
            if (!importedFiles.includes(file)) {
              importedFiles.push(file)
            }
          }
        }
      })
    })

    entryImports[entryName] = importedFiles
  })

  // Normalize to unix path separators for consistency
  for (const [name, files] of Object.entries(entryImports)) {
    entryImports[name] = files.map((f) => unixify(f))
  }

  return entryImports
}
