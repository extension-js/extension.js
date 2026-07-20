//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import {parseJsonSafe} from '../lib/parse-json-safe'
import type {PluginInterface} from '../types'
import * as messages from './compilation-lib/messages'
import {
  isBannerPrinted,
  setPendingCompilationLine
} from './compilation-lib/shared-state'

export class BoringPlugin {
  public static readonly name: string = 'plugin-boring'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  private sawUserInvalidation = false
  private printedPostBannerStartupSuccess = false
  private lastKnownManifestName?: string

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
      const hasErrors = Boolean(stats?.hasErrors?.())
      const hasWarnings = Boolean(stats?.hasWarnings?.())
      const browserLaunchEnabled =
        String(process.env.EXTENSION_BROWSER_LAUNCH_ENABLED || '1') !== '0'

      stats.compilation.name = undefined
      const duration = stats.compilation.endTime! - stats.compilation.startTime!
      // A throw here escapes hooks.done into Watching._done and kills the watch loop
      // (a mid-save manifest is routinely invalid JSON); never propagate.
      let manifestName: string | undefined
      try {
        const parsedName = parseJsonSafe(
          fs.readFileSync(this.manifestPath, 'utf-8')
        ).name
        if (typeof parsedName === 'string' && parsedName) {
          this.lastKnownManifestName = parsedName
        }
        manifestName = parsedName
      } catch {
        manifestName = this.lastKnownManifestName
      }
      const line = messages.boring(manifestName || 'Extension', duration, stats)

      try {
        // Rspack does not always populate modifiedFiles for asset-only rebuilds; merge
        // with the compiler watch set so suppression clears on HTML changes.
        const fromCompilation = Array.from(
          (stats?.compilation as {modifiedFiles?: Set<string>} | undefined)
            ?.modifiedFiles || []
        )
        const fromCompiler = Array.from(compiler.modifiedFiles ?? [])
        const modifiedFiles = [
          ...new Set([...fromCompilation, ...fromCompiler])
        ].map((file) => String(file).replace(/\\/g, '/'))
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

        // Multiple successful compiles can precede the banner during startup; keep
        // only the last and flush it when the banner arrives.
        if (
          browserLaunchEnabled &&
          !isBannerPrinted() &&
          !hasErrors &&
          !hasWarnings
        ) {
          this.printedPostBannerStartupSuccess = true
          setPendingCompilationLine(line)
          return
        }

        // Runner startup can produce extra successful passes; keep one post-banner
        // success line and suppress duplicates until the first real invalidation.
        if (browserLaunchEnabled && !hasErrors && !hasWarnings) {
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
