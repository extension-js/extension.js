// ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗     ██╗██████╗ ███████╗██████╗     ██╗  ██╗ ██████╗  ██████╗ ██╗  ██╗███████╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║     ██║██╔══██╗██╔════╝██╔══██╗    ██║  ██║██╔═══██╗██╔═══██╗██║ ██╔╝██╔════╝
// ██║     ██║   ██║██╔████╔██║██████╔╝██║     ██║██████╔╝█████╗  ██████╔╝    ███████║██║   ██║██║   ██║█████╔╝ ███████╗
// ██║     ██║   ██║██║╚██╔╝██║██╔══██╗██║     ██║██╔══██╗██╔══╝  ██╔══██╗    ██╔══██║██║   ██║██║   ██║██╔═██╗ ╚════██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██████╔╝███████╗██║██║  ██║███████╗██║  ██║    ██║  ██║╚██████╔╝╚██████╔╝██║  ██╗███████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compiler} from '@rspack/core'
import * as messages from './messages'
import {scrubBrand} from '../webpack-lib/branding'

export function setupCompilerHooks(compiler: Compiler, port: number): void {
  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'
  let reportedNoEntries = false

  compiler.hooks.invalid.tap('extension.js:invalid', () => {
    if (verbose) {
      console.log(messages.bundlerRecompiling())
    }
  })

  compiler.hooks.failed.tap('extension.js:failed', (error: unknown) => {
    console.error(messages.bundlerFatalError(error))
  })

  compiler.hooks.done.tap('extension.js:done', (stats: any) => {
    try {
      if (stats?.hasErrors?.()) {
        const str = stats?.toString?.({
          colors: true,
          all: false,
          errors: true,
          warnings: true
        })
        if (str) console.error(scrubBrand(str))
      } else if (stats?.hasWarnings?.()) {
        const str = stats?.toString?.({
          colors: true,
          all: false,
          errors: false,
          warnings: true
        })

        if (str) console.warn(scrubBrand(str))
      }

      // Warn when nothing is being built on the first pass
      if (!reportedNoEntries) {
        const info = stats.toJson({
          all: false,
          assets: true,
          entrypoints: true
        })
        const hasAssets = Array.isArray(info?.assets) && info.assets.length > 0
        const entrypoints = info?.entrypoints || {}
        const hasEntrypoints =
          entrypoints && Object.keys(entrypoints).length > 0

        if (!hasAssets && !hasEntrypoints) {
          reportedNoEntries = true
          console.warn(messages.noEntrypointsDetected(port))
        }
      }
    } catch (error) {
      const str = stats?.toString({
        colors: true,
        all: false,
        errors: true,
        warnings: true
      })
      if (str) console.error(scrubBrand(str))
    }
  })
}
