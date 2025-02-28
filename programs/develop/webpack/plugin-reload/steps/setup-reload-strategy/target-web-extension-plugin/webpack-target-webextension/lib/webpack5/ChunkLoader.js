// @ts-check
const BrowserRuntime = require('./RuntimeModules/BrowserRuntime.js')
const LoadScriptRuntimeModule = require('./RuntimeModules/LoadScript.js')
const PublicPathRuntimeModule = require('./RuntimeModules/PublicPath.js')
const AutoPublicPathRuntimeModule = require('./RuntimeModules/AutoPublicPath.js')
const ChunkLoaderFallbackRuntimeModule = require('./RuntimeModules/ChunkLoaderFallback.js')

module.exports = class WebExtensionChuckLoaderRuntimePlugin {
  /**
   * @param {import('../../index.d.ts').BackgroundOptions} options
   */
  constructor(options) {
    this.options = options
    this.rspackAutoPublicPath = false
  }
  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    if ('rspack' in compiler) {
      const { output } = compiler.options
      // rspack won't hide auto_public_path runtime module even we provided one
      if (output.publicPath === undefined || output.publicPath === 'auto') {
        output.publicPath = ''
        this.rspackAutoPublicPath = true
      }
    }
    compiler.hooks.compilation.tap(WebExtensionChuckLoaderRuntimePlugin.name, (compilation) => {
      this.tap(compiler, compilation)
    })
  }

  /**
   * @param {import('webpack').Compiler} compiler
   * @param {import('webpack').Compilation} compilation
   */
  tap(compiler, compilation) {
    const { RuntimeGlobals } = compiler.webpack
    const { options } = this

    compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.loadScript)
      .tap(WebExtensionChuckLoaderRuntimePlugin.name, (chunk, set) => {
        set.add(BrowserRuntime.RuntimeGlobal)
        compilation.addRuntimeModule(
          chunk,
          LoadScriptRuntimeModule(
            compiler.webpack,
            compilation.outputOptions.environment.dynamicImport !== false,
            options.classicLoader !== false,
          ),
        )
        return true
      })

    compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.publicPath)
      .tap(WebExtensionChuckLoaderRuntimePlugin.name, (chunk, set) => {
        const { outputOptions } = compilation
        const { publicPath, scriptType } = outputOptions

        if (publicPath === 'auto' || (publicPath === '' && this.rspackAutoPublicPath)) {
          const module = AutoPublicPathRuntimeModule(compiler.webpack)
          set.add(BrowserRuntime.RuntimeGlobal)
          if (scriptType !== 'module') set.add(RuntimeGlobals.global)
          compilation.addRuntimeModule(chunk, module)
        } else {
          set.add(BrowserRuntime.RuntimeGlobal)
          const module = PublicPathRuntimeModule(compiler.webpack)

          if (typeof publicPath !== 'string' || /\[(full)?hash\]/.test(publicPath)) {
            module.fullHash = true
          }

          compilation.addRuntimeModule(chunk, module)
        }
        return true
      })

    if (options.classicLoader !== false) {
      // we used to use hooks.afterChunks but that is missing in rspack.
      // <del>hooks.optimizeChunkModules</del> (this crashes rspack with splitChunks: { chunks: 'all', minSize: 1 })
      // hooks.afterOptimizeModules looks good for both webpack and rspack.
      compilation.hooks.afterOptimizeModules.tap(WebExtensionChuckLoaderRuntimePlugin.name, () => {
        const { pageEntry, serviceWorkerEntry } = options
        const entryPoint1 = pageEntry && compilation.entrypoints.get(pageEntry)
        const entryPoint2 = serviceWorkerEntry && compilation.entrypoints.get(serviceWorkerEntry)

        if (entryPoint1) {
          compilation.addRuntimeModule(entryPoint1.chunks[0], ChunkLoaderFallbackRuntimeModule(compiler.webpack))
        }
        if (entryPoint2) {
          compilation.addRuntimeModule(entryPoint2.chunks[0], ChunkLoaderFallbackRuntimeModule(compiler.webpack))
        }
      })
    }
  }
}
