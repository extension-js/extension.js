// @ts-check
const createEagerlyLoadChunksRuntimeModule = require('./RuntimeModules/EagerlyLoadChunks.js')

module.exports = class WebExtensionServiceWorkerEntryPlugin {
  /**
   * @param {import('../../index.d.ts').BackgroundOptions} options
   * @param {boolean} backgroundOutputEmitted
   */
  constructor(options, backgroundOutputEmitted) {
    this.options = options
    this.backgroundOutputEmitted = backgroundOutputEmitted
  }
  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    const { javascript, sources } = compiler.webpack
    const entry = this.options.serviceWorkerEntry
    if (entry === undefined) return
    if (!(compiler.options.output.module || compiler.options.experiments.outputModule)) {
      const hook = compiler.hooks.entryOption
      // Set chunkLoading to import-scripts
      hook.tap(WebExtensionServiceWorkerEntryPlugin.name, (context, entries) => {
        if (typeof entries === 'function') {
          if (this.options.noDynamicEntryWarning) return
          console.warn(`[webpack-extension-target] Dynamic entry points not supported yet.
You must manually set the chuck loading of entry point ${entry} to "import-scripts".

See https://webpack.js.org/configuration/entry-context/#entry-descriptor

Set background.noDynamicEntryWarning to true to disable this warning.
`)
        }
        /** @type {import('@rspack/core').EntryDescriptionNormalized} */
        const selectedEntry = /** @type {any} */ (entries)[entry]
        if (!selectedEntry) throw new Error(`[webpack-extension-target] There is no entry called ${entry}.`)
        selectedEntry.chunkLoading = 'import-scripts'
      })
    }

    // Set all lazy chunks to eagerly loaded
    // See https://bugs.chromium.org/p/chromium/issues/detail?id=1198822
    if (this.options.eagerChunkLoading !== false) {
      compiler.hooks.compilation.tap(WebExtensionServiceWorkerEntryPlugin.name, (compilation) => {
        compilation.hooks.afterOptimizeChunkIds?.tap(WebExtensionServiceWorkerEntryPlugin.name, () => {
          const entryPoint = compilation.entrypoints.get(entry)
          if (!entryPoint) return
          const entryChunk = entryPoint.getEntrypointChunk()

          const reachableChunks = getReachableChunks(entryPoint, new Set(entryPoint.chunks))
          const reachableChunkIds = new Set([...reachableChunks].map((x) => x.id))
          for (const id of getInitialChunkIds(entryChunk, compilation.chunkGraph, chunkHasJs)) {
            reachableChunkIds.delete(id)
          }

          if (reachableChunkIds.size) {
            const EagerlyLoadChunksRuntimeModule = createEagerlyLoadChunksRuntimeModule(compiler.webpack)
            compilation.hooks.additionalTreeRuntimeRequirements.tap(
              EagerlyLoadChunksRuntimeModule.name,
              (chunk, set) => {
                if (chunk.id !== entryChunk.id) return
                set.add(compiler.webpack.RuntimeGlobals.ensureChunkHandlers)
                compilation.addRuntimeModule(entryChunk, new EagerlyLoadChunksRuntimeModule([...reachableChunkIds]))
              },
            )
          }
        })
      })
    }

    if (
      this.options.tryCatchWrapper !== false &&
      compiler.options.output.chunkFormat !== 'module' &&
      !this.backgroundOutputEmitted
    ) {
      compiler.hooks.compilation.tap(WebExtensionServiceWorkerEntryPlugin.name, (compilation) => {
        const hooks = javascript.JavascriptModulesPlugin.getCompilationHooks(compilation)
        if (hooks.renderContent) {
          // rspack don't have it
          hooks.renderContent.tap(WebExtensionServiceWorkerEntryPlugin.name, (source, context) => {
            const entryPoint = compilation.entrypoints.get(entry)
            const entryChunk = entryPoint?.getEntrypointChunk()
            if (entryChunk !== context.chunk) return source
            return new sources.ConcatSource(
              '/******/ try { // If the initial code of the serviceWorkerEntry throws, the console cannot be opened.\n',
              source,
              '\n/******/ } catch (e) {\n/******/ 	Promise.reject(e);\n/******/ }',
            )
          })
        }
      })
    }
  }
}

// webpack/lib/javascript/StartupHelpers.js
/**
 * @param {import('webpack').Chunk} chunk the chunk
 * @param {import('webpack').ChunkGraph} chunkGraph the chunk graph
 * @param {function(import('webpack').Chunk, import('webpack').ChunkGraph): boolean} filterFn filter function
 * @returns {Set<number | string>} initially fulfilled chunk ids
 */
function getInitialChunkIds(chunk, chunkGraph, filterFn) {
  const initialChunkIds = new Set(chunk.ids)
  for (const c of chunk.getAllInitialChunks()) {
    if (c === chunk || filterFn(c, chunkGraph) || !c.ids) continue
    for (const id of c.ids) initialChunkIds.add(id)
  }
  return initialChunkIds
}

// webpack/lib/javascript/JavascriptModulesPlugin.js
/**
 * @param {import('webpack').Chunk} chunk a chunk
 * @param {import('webpack').ChunkGraph} chunkGraph the chunk graph
 * @returns {boolean} true, when a JS file is needed for this chunk
 */
function chunkHasJs(chunk, chunkGraph) {
  if (chunkGraph.getNumberOfEntryModules(chunk) > 0) return true
  return !!chunkGraph.getChunkModulesIterableBySourceType(chunk, 'javascript')
}
/**
 * @param {import('webpack').ChunkGroup} chunkGroup
 * @param {Set<import('webpack').Chunk>} reachableChunks
 * @param {Set<import('webpack').ChunkGroup>} visitedChunkGroups
 */
function getReachableChunks(chunkGroup, reachableChunks = new Set(), visitedChunkGroups = new Set()) {
  for (const x of chunkGroup.getChildren()) {
    if (visitedChunkGroups.has(x)) continue
    else {
      visitedChunkGroups.add(x)
      x.chunks.forEach((x) => reachableChunks.add(x))
      getReachableChunks(x, reachableChunks, visitedChunkGroups)
    }
  }
  return reachableChunks
}
