// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler, Stats} from '@rspack/core'
import {renderStatsBlocks} from '../lib/stats-handler'
import {humanLine} from './lifecycle-stream'
import * as messages from './messages'

export function setupCompilerLifecycleHooks(compiler: Compiler): void {
  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

  compiler.hooks.invalid.tap('extension.js:invalid', () => {
    if (verbose) {
      humanLine(messages.bundlerRecompiling())
    }
  })

  compiler.hooks.failed.tap('extension.js:failed', (error: unknown) => {
    console.error(messages.bundlerFatalError(error))
  })
}

export function setupNoBrowserBannerOnFirstDone(opts: {
  compiler: Compiler
  browser: string
  manifestPath: string
  readyPath: string
  distPath?: string
}): void {
  let printed = false
  opts.compiler.hooks.done.tap(
    'extension.js:no-browser-banner',
    (stats: Stats) => {
      if (printed) return
      if (stats?.hasErrors?.()) return
      printed = true
      // Identity first, then the state line: the card is the header for the
      // session, not a summary trailing the result it describes.
      humanLine(messages.spacerLine())
      humanLine(
        messages.browserRunnerDisabled({
          browser: opts.browser,
          manifestPath: opts.manifestPath,
          readyPath: opts.readyPath,
          distPath: opts.distPath
        })
      )
      humanLine(messages.spacerLine())
      humanLine(messages.ready('development', opts.browser))
    }
  )
}

export function setupCompilerDoneDiagnostics(
  compiler: Compiler,
  port?: number
): void {
  let reportedNoEntries = false
  compiler.hooks.done.tap('extension.js:done', (stats: Stats) => {
    try {
      if (stats?.hasErrors?.()) {
        const str = renderStatsBlocks(stats, {errors: true, warnings: true})
        if (str) console.error(str)
      } else if (stats?.hasWarnings?.()) {
        const str = renderStatsBlocks(stats, {errors: false, warnings: true})
        if (str) console.warn(str)
      }

      if (!reportedNoEntries && typeof port === 'number') {
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
    } catch {
      const str = renderStatsBlocks(stats, {errors: true, warnings: true})
      if (str) console.error(str)
    }
  })
}
