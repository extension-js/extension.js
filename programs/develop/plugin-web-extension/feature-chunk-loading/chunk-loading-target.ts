// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {ChunkLoadingTargetOptions} from './options'
import {
  BrowserRuntimeModule,
  RuntimeGlobal
} from './runtime-modules/browser-runtime'
import {ChunkLoaderRuntime} from './steps/chunk-loader'
import {NoDangerNamePlugin} from './steps/no-danger-name'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

// Loads the chunks of an extension bundle the way each world allows: a
// native import in the extension world, a bridge or the page in MAIN.
export class ChunkLoadingTarget {
  private readonly options: ChunkLoadingTargetOptions

  constructor(options: ChunkLoadingTargetOptions = {}) {
    const {background} = options

    if (
      background?.serviceWorkerEntry &&
      background.serviceWorkerEntry === background.pageEntry
    ) {
      throw new Error(
        'background.serviceWorkerEntry must not be the same as background.pageEntry. A service worker and a background page are separate entries.'
      )
    }

    this.options = options
  }

  apply(compiler: Compiler) {
    new ChunkLoaderRuntime(this.options).apply(compiler)
    new NoDangerNamePlugin().apply(compiler)

    // Every browser an extension targets has a native import(), which is
    // the loader an isolated world chunk needs.
    compiler.hooks.environment.tap(ChunkLoadingTarget.name, () => {
      const {output} = compiler.options
      const environment = (output.environment ??= {})

      if (environment.dynamicImport !== false) {
        environment.dynamicImport = true
      }
    })

    compiler.hooks.compilation.tap(ChunkLoadingTarget.name, (compilation) => {
      compilation.hooks.runtimeRequirementInTree
        .for(RuntimeGlobal)
        .tap(ChunkLoadingTarget.name, (chunk) => {
          compilation.addRuntimeModule(
            chunk,
            BrowserRuntimeModule(
              compiler.webpack,
              !!this.options.weakRuntimeCheck
            )
          )

          return true
        })
    })
  }
}
