// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import type {
  ChunkLoadingBackgroundOptions,
  ChunkLoadingTargetOptions,
  ContentScriptsMeta
} from '../options'
import {RuntimeGlobal} from '../runtime-modules/browser-runtime'
import {ChunkLoaderFallbackRuntimeModule} from '../runtime-modules/chunk-loader-fallback'
import {LoadScriptRuntimeModule} from '../runtime-modules/load-script'
import {PublicPathRuntimeModule} from '../runtime-modules/public-path'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

export class ChunkLoaderRuntime {
  private readonly background: ChunkLoadingBackgroundOptions
  private readonly contentScriptsMeta: ContentScriptsMeta
  // A Gecko MAIN world file opens on the read that takes the base.
  private readonly gecko: boolean
  // The attribute this extension's bridge writes the base under.
  private readonly baseAttribute: string | undefined
  // The one scheme the build's engine serves an extension under.
  private readonly baseScheme: string | undefined

  constructor(options: ChunkLoadingTargetOptions) {
    this.background = options.background || {}
    this.contentScriptsMeta = options.contentScriptsMeta || {}
    this.gecko = options.gecko === true
    this.baseAttribute =
      typeof options.baseAttribute === 'string'
        ? options.baseAttribute
        : undefined

    this.baseScheme =
      typeof options.baseScheme === 'string' ? options.baseScheme : undefined
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(ChunkLoaderRuntime.name, (compilation) => {
      this.tap(compiler, compilation)
    })
  }

  private tap(compiler: Compiler, compilation: Compilation) {
    const {RuntimeGlobals} = compiler.webpack
    const {background} = this

    compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.loadScript)
      .tap(ChunkLoaderRuntime.name, (chunk, set) => {
        set.add(RuntimeGlobal)
        compilation.addRuntimeModule(
          chunk,
          LoadScriptRuntimeModule(
            compiler.webpack,
            compilation.outputOptions.environment?.dynamicImport !== false,
            background.classicLoader !== false,
            this.contentScriptsMeta,
            this.gecko
          )
        )

        return true
      })

    compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.publicPath)
      .tap(ChunkLoaderRuntime.name, (chunk, set) => {
        const {publicPath} = compilation.outputOptions

        set.add(RuntimeGlobal)
        const module = PublicPathRuntimeModule(
          compiler.webpack,
          this.gecko,
          this.baseAttribute,
          this.baseScheme
        )

        if (
          typeof publicPath !== 'string' ||
          /\[(full)?hash\]/.test(publicPath)
        ) {
          module.fullHash = true
        }

        compilation.addRuntimeModule(chunk, module)

        return true
      })

    if (background.classicLoader !== false) {
      // rspack has no afterChunks hook, and the entry chunks exist by this one.
      compilation.hooks.afterOptimizeModules.tap(
        ChunkLoaderRuntime.name,
        () => {
          const {pageEntry, serviceWorkerEntry} = background
          const pageEntrypoint =
            pageEntry && compilation.entrypoints.get(pageEntry)
          const workerEntrypoint =
            serviceWorkerEntry &&
            compilation.entrypoints.get(serviceWorkerEntry)

          if (pageEntrypoint) {
            compilation.addRuntimeModule(
              pageEntrypoint.chunks[0],
              ChunkLoaderFallbackRuntimeModule(compiler.webpack)
            )
          }

          if (workerEntrypoint) {
            compilation.addRuntimeModule(
              workerEntrypoint.chunks[0],
              ChunkLoaderFallbackRuntimeModule(compiler.webpack)
            )
          }
        }
      )
    }
  }
}
