// ██████╗ ██╗   ██╗██╗██╗     ██████╗     ███████╗██╗   ██╗███████╗███╗   ██╗████████╗███████╗
// ██╔══██╗██║   ██║██║██║     ██╔══██╗    ██╔════╝██║   ██║██╔════╝████╗  ██║╚══██╔══╝██╔════╝
// ██████╔╝██║   ██║██║██║     ██║  ██║    █████╗  ██║   ██║█████╗  ██╔██╗ ██║   ██║   ███████╗
// ██╔══██╗██║   ██║██║██║     ██║  ██║    ██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ╚════██║
// ██████╔╝╚██████╔╝██║███████╗██████╔╝    ███████╗ ╚████╔╝ ███████╗██║ ╚████║   ██║   ███████║
// ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝     ╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {BuildEmitter, CompiledEvent} from '../build-events'

/**
 * BuildEventBridgePlugin
 *
 * An rspack plugin that emits build lifecycle events onto a BuildEmitter.
 * This bridges rspack's hook system with a plain EventEmitter so that the
 * CLI (programs/extension) can coordinate browser launch/reload without
 * importing rspack.
 *
 * Currently emits:
 * - `compiled` after each successful build (with isFirstCompile flag)
 * - `error` when compilation has errors
 *
 * The BrowsersPlugin still runs alongside this plugin for now, handling
 * the actual browser launch/reload. In a future phase, the CLI will consume
 * these events directly and BrowsersPlugin will be removed.
 */
export class BuildEventBridgePlugin {
  static readonly name = 'plugin-build-events'
  private isFirstCompile = true

  constructor(private readonly emitter: BuildEmitter) {}

  apply(compiler: Compiler) {
    compiler.hooks.done.tapPromise(
      BuildEventBridgePlugin.name,
      async (stats) => {
        const compilation = stats.compilation
        const hasErrors =
          compilation.errors && compilation.errors.length > 0

        if (hasErrors) {
          this.emitter.emit('error', {
            errors: compilation.errors.map((e: any) =>
              typeof e === 'string' ? e : e.message || String(e)
            )
          })
          return
        }

        const event: CompiledEvent = {
          outputPath: String(compilation.options?.output?.path || ''),
          contextDir: String(compilation.options?.context || ''),
          isFirstCompile: this.isFirstCompile
          // reloadInstruction is undefined for now — signals a full reload.
          // Advanced reload classification (content-scripts vs service-worker)
          // will be extracted from ChromiumHardReloadPlugin in a future phase.
        }

        this.isFirstCompile = false
        this.emitter.emit('compiled', event)
      }
    )
  }
}
