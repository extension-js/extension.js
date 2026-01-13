import LoadScriptRuntimeModule from './RuntimeModules/LoadScript'
import PublicPathRuntimeModule from './RuntimeModules/PublicPath'
import AutoPublicPathRuntimeModule from './RuntimeModules/AutoPublicPath'
import ChunkLoaderFallbackRuntimeModule from './RuntimeModules/ChunkLoaderFallback'
import {RuntimeGlobal} from './RuntimeModules/BrowserRuntime'

export default class WebExtensionChuckLoaderRuntimePlugin {
  private readonly pluginOptions: any
  private readonly options: any
  private readonly contentScriptsMeta: Record<string, any>
  private rspackAutoPublicPath = false

  constructor(options: any) {
    // Back-compat:
    // - upstream calls with background options only
    // - Extension.js passes full plugin options to support MAIN world bridge
    this.pluginOptions = options || {}
    this.options = this.pluginOptions.background || this.pluginOptions || {}
    this.contentScriptsMeta = this.pluginOptions.contentScriptsMeta || {}
  }

  apply(compiler: any) {
    if ('rspack' in compiler) {
      const {output} = compiler.options
      // rspack won't hide auto_public_path runtime module even we provided one
      if (output.publicPath === undefined || output.publicPath === 'auto') {
        output.publicPath = ''
        this.rspackAutoPublicPath = true
      }
    }
    compiler.hooks.compilation.tap(
      WebExtensionChuckLoaderRuntimePlugin.name,
      (compilation: any) => {
        this.tap(compiler, compilation)
      }
    )
  }

  tap(compiler: any, compilation: any) {
    const {RuntimeGlobals} = compiler.webpack
    const {options} = this

    compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.loadScript)
      .tap(
        WebExtensionChuckLoaderRuntimePlugin.name,
        (_chunk: any, set: any) => {
          set.add(RuntimeGlobal)
          compilation.addRuntimeModule(
            _chunk,
            LoadScriptRuntimeModule(
              compiler.webpack,
              compilation.outputOptions.environment.dynamicImport !== false,
              options.classicLoader !== false,
              this.contentScriptsMeta
            )
          )
          return true
        }
      )

    compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.publicPath)
      .tap(
        WebExtensionChuckLoaderRuntimePlugin.name,
        (chunk: any, set: any) => {
          const {outputOptions} = compilation
          const {publicPath, scriptType} = outputOptions

          if (
            publicPath === 'auto' ||
            (publicPath === '' && this.rspackAutoPublicPath)
          ) {
            const module = AutoPublicPathRuntimeModule(compiler.webpack)
            set.add(RuntimeGlobal)
            if (scriptType !== 'module') set.add(RuntimeGlobals.global)
            compilation.addRuntimeModule(chunk, module)
          } else {
            set.add(RuntimeGlobal)
            const module: any = PublicPathRuntimeModule(compiler.webpack)

            if (
              typeof publicPath !== 'string' ||
              /\[(full)?hash\]/.test(publicPath)
            ) {
              module.fullHash = true
            }

            compilation.addRuntimeModule(chunk, module)
          }
          return true
        }
      )

    if (options.classicLoader !== false) {
      // we used to use hooks.afterChunks but that is missing in rspack.
      // hooks.afterOptimizeModules looks good for both webpack and rspack.
      compilation.hooks.afterOptimizeModules.tap(
        WebExtensionChuckLoaderRuntimePlugin.name,
        () => {
          const {pageEntry, serviceWorkerEntry} = options
          const entryPoint1 =
            pageEntry && compilation.entrypoints.get(pageEntry)
          const entryPoint2 =
            serviceWorkerEntry &&
            compilation.entrypoints.get(serviceWorkerEntry)

          if (entryPoint1) {
            compilation.addRuntimeModule(
              entryPoint1.chunks[0],
              ChunkLoaderFallbackRuntimeModule(compiler.webpack)
            )
          }
          if (entryPoint2) {
            compilation.addRuntimeModule(
              entryPoint2.chunks[0],
              ChunkLoaderFallbackRuntimeModule(compiler.webpack)
            )
          }
        }
      )
    }
  }
}
