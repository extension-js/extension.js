//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import {Compiler} from '@rspack/core'
import * as messages from './compilation-lib/messages'
import {
  isBannerPrinted,
  setPendingCompilationLine
} from './compilation-lib/shared-state'

import {type PluginInterface} from '../webpack-types'

function readJsonFileSafe(filePath: string) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return JSON.parse(text)
}

export class BoringPlugin {
  public static readonly name: string = 'plugin-boring'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  private sawUserInvalidation = false
  private printedPostBannerStartupSuccess = false

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.watchClose.tap('develop:brand:watch-close', () => {
      this.sawUserInvalidation = false
      this.printedPostBannerStartupSuccess = false
    })

    compiler.hooks.done.tap('develop:brand', (stats) => {
      const hasErrors = Boolean((stats as any)?.hasErrors?.())
      const hasWarnings = Boolean((stats as any)?.hasWarnings?.())
      const runnerEnabled =
        String(process.env.EXTENSION_BROWSER_RUNNER_ENABLED || '1') !== '0'

      stats.compilation.name = undefined
      const duration = stats.compilation.endTime! - stats.compilation.startTime!
      const manifestName = readJsonFileSafe(this.manifestPath).name
      const line = messages.boring(manifestName, duration, stats)

      try {
        const modifiedFiles = Array.from(
          (((stats as any)?.compilation as any)
            ?.modifiedFiles as Set<string>) || []
        ).map((file) => String(file).replace(/\\/g, '/'))
        if (!this.sawUserInvalidation && modifiedFiles.length > 0) {
          const context = String(compiler?.options?.context || '').replace(
            /\\/g,
            '/'
          )
          const hasUserFileChange = modifiedFiles.some((file) => {
            const inProject = !context || file.startsWith(`${context}/`)
            const isGenerated =
              file.includes('/dist/') ||
              file.includes('/extension-js/profiles/')
            return inProject && !isGenerated
          })
          if (hasUserFileChange) this.sawUserInvalidation = true
        }

        // During startup with browser runner enabled, multiple successful
        // compiles can happen before the banner is printed. Keep only the last
        // one and flush it when the banner arrives to avoid noisy duplicates
        if (runnerEnabled && !isBannerPrinted() && !hasErrors && !hasWarnings) {
          this.printedPostBannerStartupSuccess = true
          setPendingCompilationLine(line)
          return
        }

        // Runner startup can produce extra successful passes before any real
        // source invalidation happens. Keep one post-banner success line and
        // suppress additional startup-only duplicates until the first user/source
        // invalidation event
        if (runnerEnabled && !hasErrors && !hasWarnings) {
          if (!this.sawUserInvalidation) {
            if (!this.printedPostBannerStartupSuccess) {
              this.printedPostBannerStartupSuccess = true
            } else {
              return
            }
          }
        }

        // Always print the boring line to stdout so users can see
        // rebuilds and timing, even on success.
        console.log(line)
      } catch {
        // best-effort: never throw from logging
      }
    })
  }
}
