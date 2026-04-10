import createEagerlyLoadChunksRuntimeModule from './RuntimeModules/EagerlyLoadChunks'

export default class WebExtensionServiceWorkerEntryPlugin {
  private readonly options: any
  private readonly backgroundOutputEmitted: boolean

  constructor(options: any, backgroundOutputEmitted: boolean) {
    this.options = options
    this.backgroundOutputEmitted = backgroundOutputEmitted
  }

  apply(compiler: any) {
    const {javascript, sources} = compiler.webpack
    const entry = this.options.serviceWorkerEntry
    if (entry === undefined) return
    if (
      !(
        compiler.options.output.module ||
        compiler.options.experiments.outputModule
      )
    ) {
      const hook = compiler.hooks.entryOption
      // Set chunkLoading to import-scripts
      hook.tap(
        WebExtensionServiceWorkerEntryPlugin.name,
        (_context: any, entries: any) => {
          if (typeof entries === 'function') {
            if (this.options.noDynamicEntryWarning) return
            console.warn(`[webpack-extension-target] Dynamic entry points not supported yet.
You must manually set the chuck loading of entry point ${entry} to "import-scripts".

See https://webpack.js.org/configuration/entry-context/#entry-descriptor

Set background.noDynamicEntryWarning to true to disable this warning.
`)
          }
          const selectedEntry = entries?.[entry]
          if (!selectedEntry)
            throw new Error(
              `[webpack-extension-target] There is no entry called ${entry}.`
            )
          selectedEntry.chunkLoading = 'import-scripts'
        }
      )
    }

    // Set all lazy chunks to eagerly loaded
    // See https://bugs.chromium.org/p/chromium/issues/detail?id=1198822
    if (this.options.eagerChunkLoading !== false) {
      compiler.hooks.compilation.tap(
        WebExtensionServiceWorkerEntryPlugin.name,
        (compilation: any) => {
          // note: rspack don't have this
          compilation.hooks.afterOptimizeChunkIds?.tap(
            WebExtensionServiceWorkerEntryPlugin.name,
            () => {
              const entryPoint = compilation.entrypoints.get(entry)
              if (!entryPoint) return
              const entryChunk = entryPoint.getEntrypointChunk()

              const reachableChunks = getReachableChunks(
                entryPoint,
                new Set(entryPoint.chunks)
              )
              const reachableChunkIds = new Set(
                [...reachableChunks].map((x: any) => x.id)
              )
              for (const id of getInitialChunkIds(
                entryChunk,
                compilation.chunkGraph,
                chunkHasJs
              )) {
                reachableChunkIds.delete(id)
              }

              if (reachableChunkIds.size) {
                const EagerlyLoadChunksRuntimeModule =
                  createEagerlyLoadChunksRuntimeModule(compiler.webpack)
                compilation.hooks.additionalTreeRuntimeRequirements.tap(
                  EagerlyLoadChunksRuntimeModule.name,
                  (chunk: any, set: any) => {
                    if (chunk.id !== entryChunk.id) return
                    set.add(compiler.webpack.RuntimeGlobals.ensureChunkHandlers)
                    compilation.addRuntimeModule(
                      entryChunk,
                      new EagerlyLoadChunksRuntimeModule([...reachableChunkIds])
                    )
                  }
                )
              }
            }
          )
        }
      )
    }

    if (
      this.options.tryCatchWrapper !== false &&
      compiler.options.output.chunkFormat !== 'module' &&
      !this.backgroundOutputEmitted
    ) {
      compiler.hooks.compilation.tap(
        WebExtensionServiceWorkerEntryPlugin.name,
        (compilation: any) => {
          const hooks =
            javascript.JavascriptModulesPlugin.getCompilationHooks(compilation)
          if (hooks.renderContent) {
            // rspack don't have it
            hooks.renderContent.tap(
              WebExtensionServiceWorkerEntryPlugin.name,
              (source: any, context: any) => {
                const entryPoint = compilation.entrypoints.get(entry)
                const entryChunk = entryPoint?.getEntrypointChunk()
                if (entryChunk !== context.chunk) return source
                return new sources.ConcatSource(
                  '/******/ try { // If the initial code of the serviceWorkerEntry throws, the console cannot be opened.\n',
                  source,
                  '\n/******/ } catch (e) {\n/******/ \tPromise.reject(e);\n/******/ }'
                )
              }
            )
          }
        }
      )
    }
  }
}

// webpack/lib/javascript/StartupHelpers.js
function getInitialChunkIds(chunk: any, chunkGraph: any, filterFn: any) {
  const initialChunkIds = new Set(chunk.ids)
  for (const c of chunk.getAllInitialChunks()) {
    if (c === chunk || filterFn(c, chunkGraph) || !c.ids) continue
    for (const id of c.ids) initialChunkIds.add(id)
  }
  return initialChunkIds
}

// webpack/lib/javascript/JavascriptModulesPlugin.js
function chunkHasJs(chunk: any, chunkGraph: any) {
  if (chunkGraph.getNumberOfEntryModules(chunk) > 0) return true
  return !!chunkGraph.getChunkModulesIterableBySourceType(chunk, 'javascript')
}

function getReachableChunks(
  chunkGroup: any,
  reachableChunks: Set<any> = new Set(),
  visitedChunkGroups: Set<any> = new Set()
) {
  for (const x of chunkGroup.getChildren()) {
    if (visitedChunkGroups.has(x)) continue
    visitedChunkGroups.add(x)
    x.chunks.forEach((c: any) => reachableChunks.add(c))
    getReachableChunks(x, reachableChunks, visitedChunkGroups)
  }
  return reachableChunks
}
