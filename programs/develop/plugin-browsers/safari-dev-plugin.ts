// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compiler} from '@rspack/core'
import {BuildEmitter, type RunnerPlugin} from './index'

export type SafariPackagerFn = (
  distPath: string,
  mode: 'full' | 'resync'
) => Promise<void>

// Safari has no live-reload channel, but the dev server already runs the
// bundler in watch mode. This plugin rides that watch loop: on the first
// successful compile it does the full package
// (convert > xcodebuild > open > guided enable)
// on every later compile it re-runs xcodebuild to resync the
// generated app's resources with the freshly rebuilt dist/safari
export class SafariDevPlugin implements RunnerPlugin {
  static readonly name = 'safari-dev'

  readonly emitter = new BuildEmitter()
  extensionsToLoad: string[] = []

  private firstRun = true

  constructor(private readonly packager: SafariPackagerFn) {}

  apply(compiler: Compiler) {
    compiler.hooks.done.tapPromise(SafariDevPlugin.name, async (stats: any) => {
      const compilation = stats.compilation
      const hasErrors = compilation.errors && compilation.errors.length > 0

      if (hasErrors) {
        this.emitter.emit('error', {
          errors: compilation.errors.map((e: any) =>
            typeof e === 'string' ? e : e.message || String(e)
          )
        })
        return
      }

      const outputPath = String(compilation.options?.output?.path || '')
      const contextDir = String(compilation.options?.context || '')
      const wasFirstRun = this.firstRun

      try {
        await this.packager(outputPath, wasFirstRun ? 'full' : 'resync')
      } catch (error) {
        // Keep firstRun true on failure: a failed first package never opens
        // the app or runs the guided-enable step, so the next compile must
        // retry the full flow rather than silently dropping to a resync.
        this.emitter.emit('error', {
          errors: [error instanceof Error ? error.message : String(error)]
        })
        return
      }

      this.firstRun = false

      this.emitter.emit('compiled', {
        outputPath,
        contextDir,
        isFirstCompile: wasFirstRun
      })
    })
  }
}
