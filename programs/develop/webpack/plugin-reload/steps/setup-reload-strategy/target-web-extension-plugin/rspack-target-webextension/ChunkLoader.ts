import {Compiler, sources} from '@rspack/core'
import {LoadScriptRuntimeModule} from './RuntimeModules/LoadScript'
import {PublicPathRuntimeModule} from './RuntimeModules/PublicPath'
import {AutoPublicPathRuntimeModule} from './RuntimeModules/AutoPublicPath'
import {ChunkLoaderFallbackRuntimeModule} from './RuntimeModules/ChunkLoaderFallback'
import {BackgroundOptions} from './types'

export class ChuckLoaderRuntimePlugin {
  private readonly options: BackgroundOptions
  private readonly weakRuntimeCheck: boolean

  constructor(options: BackgroundOptions, weakRuntimeCheck: boolean) {
    this.options = options
    this.weakRuntimeCheck = weakRuntimeCheck
  }

  apply(compiler: Compiler) {
    const {RuntimeGlobals /*, Template */} = compiler.webpack
    const {options} = this

    compiler.hooks.compilation.tap(
      ChuckLoaderRuntimePlugin.name,
      (compilation) => {
        // Handling LoadScript Runtime Module
        compilation.hooks.processAssets.tap(
          ChuckLoaderRuntimePlugin.name,
          () => {
            const loadScriptModule = LoadScriptRuntimeModule(
              compiler.webpack,
              compilation.outputOptions.environment?.dynamicImport,
              options.classicLoader !== false,
              this.weakRuntimeCheck
            )

            // Add the generated code directly to assets
            const source = new sources.RawSource(loadScriptModule.source())
            compilation.emitAsset('load-script-runtime.js', source)
          }
        )

        // Handling PublicPath Runtime Module
        compilation.hooks.processAssets.tap(
          ChuckLoaderRuntimePlugin.name,
          () => {
            const {outputOptions} = compilation
            const {publicPath, scriptType} = outputOptions

            let module
            if (publicPath === 'auto') {
              module = AutoPublicPathRuntimeModule(
                compiler.webpack,
                this.weakRuntimeCheck
              )
            } else {
              module = PublicPathRuntimeModule(
                compiler.webpack,
                this.weakRuntimeCheck
              )
            }

            // Adding runtime module directly to assets
            const source = new sources.RawSource(
              module.generate(compilation, {})
            )
            compilation.emitAsset('public-path-runtime.js', source)

            if (scriptType !== 'module') {
              // Handle global variables if needed
              const globalVarSource = new sources.RawSource(
                `${RuntimeGlobals.global} = window;`
              )
              compilation.emitAsset('global-var-runtime.js', globalVarSource)
            }
          }
        )

        // Handling Chunk Loader Fallback for Classic Loader
        if (options.classicLoader !== false) {
          compilation.hooks.processAssets.tap(
            ChuckLoaderRuntimePlugin.name,
            () => {
              const {entry, pageEntry, serviceWorkerEntry} = options
              const entryPoints = [
                entry && compilation.entrypoints.get(entry),
                pageEntry && compilation.entrypoints.get(pageEntry),
                serviceWorkerEntry &&
                  compilation.entrypoints.get(serviceWorkerEntry)
              ]

              entryPoints.forEach((entryPoint) => {
                if (!entryPoint) return

                const fallbackModule = ChunkLoaderFallbackRuntimeModule(
                  compiler.webpack
                )
                const source = new sources.RawSource(
                  fallbackModule.generate(compilation)
                )
                compilation.emitAsset('chunk-loader-fallback.js', source)
              })
            }
          )
        }
      }
    )
  }
}
