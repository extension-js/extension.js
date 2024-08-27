import {Compiler, Compilation, Chunk, ChunkGroup, sources} from '@rspack/core'
import {EagerlyLoadChunksPlugin} from './RuntimeModules/EagerlyLoadChunks'
import {BackgroundOptions} from './types'

export class ServiceWorkerEntryPlugin {
  private readonly options: BackgroundOptions
  private readonly entry: string

  constructor(options: BackgroundOptions, entry: string) {
    this.options = options
    this.entry = entry
  }

  apply(compiler: Compiler) {
    compiler.hooks.entryOption.tap(
      ServiceWorkerEntryPlugin.name,
      (_context, entries) => {
        if (typeof entries === 'function') {
          if (this.options.noWarningDynamicEntry) return

          console.warn(
            `[rspack-extension-target] Dynamic entry points not supported yet.\n` +
              `You must manually set the chunk loading of entry point ${this.entry} to "import-scripts".\n\n` +
              `Set background.noWarningDynamicEntry to true to disable this warning.`
          )
        }

        // @ts-expect-error entries is an object
        const selectedEntry = entries[this.entry]

        if (!selectedEntry) {
          throw new Error(
            `[rspack-extension-target] There is no entry called ${this.entry}.`
          )
        }

        selectedEntry.chunkLoading = 'import-scripts'
      }
    )

    if (this.options.eagerChunkLoading !== false) {
      compiler.hooks.compilation.tap(
        ServiceWorkerEntryPlugin.name,
        (compilation: Compilation) => {
          compilation.hooks.optimizeChunkModules.tap(
            ServiceWorkerEntryPlugin.name,
            () => {
              const entryPoint = compilation.entrypoints.get(this.entry)
              if (!entryPoint) return

              const entryChunk = Array.from(entryPoint.chunks)[0]
              const reachableChunkIds = new Set<string | number>([
                ...entryChunk.ids
              ])

              for (const id of getInitialChunkIds(
                entryChunk,
                compilation,
                chunkHasJs
              )) {
                reachableChunkIds.delete(id)
              }

              if (reachableChunkIds.size) {
                compilation.hooks.processAssets.tap(
                  {
                    name: ServiceWorkerEntryPlugin.name,
                    stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
                  },
                  () => {
                    const eagerlyLoadChunksModule = new EagerlyLoadChunksPlugin(
                      Array.from(reachableChunkIds)
                    )
                    const moduleSource = new sources.RawSource(
                      eagerlyLoadChunksModule.generate()
                    )

                    const files = [...entryChunk.files]
                    compilation.updateAsset(files[0], moduleSource)
                  }
                )
              }

              function collectAllChildren(chunkGroup: ChunkGroup) {
                chunkGroup.chunks.forEach((chunk) => {
                  if (!visitedChunkGroups.has(chunkGroup)) {
                    visitedChunkGroups.add(chunkGroup)
                    reachableChunks.add(chunk)

                    // Iterate over each child group (parent group in this case)
                    for (const parentGroup of chunkGroup.getParents()) {
                      collectAllChildren(parentGroup)
                    }
                  }
                })
              }

              const visitedChunkGroups = new Set<ChunkGroup>()
              const reachableChunks = new Set<Chunk>(entryPoint.chunks)
              collectAllChildren(entryPoint)
            }
          )
        }
      )
    }
  }
}

// Helper functions
function chunkHasJs(chunk: Chunk): boolean {
  for (const file of chunk.files) {
    if (file.endsWith('.js')) {
      return true
    }
  }
  return false
}

// Function to get the initial chunk IDs
function getInitialChunkIds(
  chunk: Chunk,
  compilation: Compilation,
  filterFn: (chunk: Chunk, compilation: Compilation) => boolean
): Set<string | number> {
  const initialChunkIds = new Set<string | number>(chunk.ids)

  for (const chunkGroup of compilation.chunkGroups) {
    if (chunkGroup.chunks.includes(chunk) || filterFn(chunk, compilation)) {
      continue
    }

    for (const id of chunkGroup.chunks.flatMap((c) => c.ids)) {
      initialChunkIds.add(id)
    }
  }

  return initialChunkIds
}
