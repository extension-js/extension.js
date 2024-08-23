import {Compiler} from '@rspack/core'

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
    const {RuntimeGlobals} = compiler.webpack
    const {options} = this

    compiler.hooks.compilation.tap(
      ChuckLoaderRuntimePlugin.name,
      (compilation) => {
        compilation.hooks.runtimeRequirementInTree
          .for(RuntimeGlobals.loadScript)
          .tap(ChuckLoaderRuntimePlugin.name, (chunk) => {
            compilation.addRuntimeModule(
              chunk,
              LoadScriptRuntimeModule(
                compiler.webpack,
                compilation.outputOptions.environment &&
                  compilation.outputOptions.environment.dynamicImport,
                options && options.classicLoader !== false,
                this.weakRuntimeCheck
              )
            )
            return true
          })

        compilation.hooks.runtimeRequirementInTree
          .for(RuntimeGlobals.publicPath)
          .tap(ChuckLoaderRuntimePlugin.name, (chunk, set) => {
            const {outputOptions} = compilation
            const {publicPath, scriptType} = outputOptions

            if (publicPath === 'auto') {
              const module = AutoPublicPathRuntimeModule(
                compiler.webpack,
                this.weakRuntimeCheck
              )

              if (scriptType !== 'module') {
                set.add(RuntimeGlobals.global)
              }

              compilation.addRuntimeModule(chunk, module)
            } else {
              const module = PublicPathRuntimeModule(
                compiler.webpack,
                this.weakRuntimeCheck
              )

              if (
                typeof publicPath !== 'string' ||
                /\[(full)?hash\]/.test(publicPath)
              ) {
                module.fullHash = true
              }

              compilation.addRuntimeModule(chunk, module)
            }
            return true
          })

        if (options && options.classicLoader !== false) {
          compilation.hooks.afterChunks.tap(
            ChuckLoaderRuntimePlugin.name,
            () => {
              const {entry, pageEntry, serviceWorkerEntry} = options
              const entryPoint = entry && compilation.entrypoints.get(entry)
              const entryPoint2 =
                pageEntry && compilation.entrypoints.get(pageEntry)
              const entryPoint3 =
                serviceWorkerEntry &&
                compilation.entrypoints.get(serviceWorkerEntry)

              for (const entry of [entryPoint, entryPoint2, entryPoint3]) {
                if (!entry) continue

                compilation.addRuntimeModule(
                  entry.chunks[0],
                  ChunkLoaderFallbackRuntimeModule(compiler.webpack)
                )
              }
            }
          )
        }
      }
    )
  }
}
