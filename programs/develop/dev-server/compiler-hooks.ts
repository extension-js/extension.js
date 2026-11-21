// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {devAdditionsOf} from '../lib/dev-additions'
import {humanLine} from '../lib/messaging'
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

// What the banner reads from a finished compile.
export interface FirstDoneStats {
  hasErrors(): boolean
  compilation?: object
}

// The banner taps one hook, so a host hands it no more than that.
export interface DoneHookHost {
  hooks: {
    done: {tap(name: string, fn: (stats: FirstDoneStats) => void): void}
  }
}

export function setupNoBrowserBannerOnFirstDone(opts: {
  compiler: DoneHookHost
  browser: string
  manifestPath: string
  readyPath: string
  distPath?: string
}): void {
  let printed = false
  opts.compiler.hooks.done.tap(
    'extension.js:no-browser-banner',
    (stats: FirstDoneStats) => {
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

      const devAdditions = messages.devAdditionsNote(
        devAdditionsOf(stats?.compilation) || []
      )
      if (devAdditions) humanLine(devAdditions)

      humanLine(messages.spacerLine())
      humanLine(messages.ready('development', opts.browser))
    }
  )
}
