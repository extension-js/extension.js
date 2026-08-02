//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import {humanLine} from '../dev-server/lifecycle-stream'
import {parseJsonSafe} from '../lib/parse-json-safe'
import type {PluginInterface} from '../types'
import * as messages from './compilation-lib/messages'

export class BoringPlugin {
  public static readonly name: string = 'plugin-boring'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  private sawUserInvalidation = false
  private printedStartupSuccess = false
  private printedStartupWarning = false
  private lastKnownManifestName?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.watchClose.tap('develop:brand:watch-close', () => {
      this.sawUserInvalidation = false
      this.printedStartupSuccess = false
      this.printedStartupWarning = false
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
          manifestName = parsedName
        } else {
          // parse-json-safe maps an empty mid-save manifest to {} without
          // throwing; keep the last-known name instead of the generic one.
          manifestName = this.lastKnownManifestName
        }
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
          // Generated roots are matched by whole path segment against the
          // compiler's own output dir and <context>/dist, mirroring the
          // watchOptions contract: a source path merely containing "dist"
          // must still count as a user change.
          const outputPath = String(
            compiler?.options?.output?.path || ''
          ).replace(/\\/g, '/')
          const distRoot = context ? `${context}/dist` : ''
          const isUnderRoot = (file: string, root: string) =>
            root !== '' && (file === root || file.startsWith(`${root}/`))
          const hasUserFileChange = modifiedFiles.some((file) => {
            const inProject = !context || file.startsWith(`${context}/`)
            const isGenerated =
              isUnderRoot(file, outputPath) ||
              isUnderRoot(file, distRoot) ||
              file.includes('/extension-js/profiles/')
            return inProject && !isGenerated
          })
          if (hasUserFileChange) this.sawUserInvalidation = true
        }

        // Runner startup can produce extra passes; keep one startup line per
        // severity and suppress duplicates until the first real invalidation.
        // A warning-bearing first pass must not swallow the later success line.
        if (browserLaunchEnabled && !hasErrors && !this.sawUserInvalidation) {
          if (hasWarnings) {
            if (this.printedStartupWarning) return
            this.printedStartupWarning = true
          } else {
            if (this.printedStartupSuccess) return
            this.printedStartupSuccess = true
          }
        }

        // Always print the boring line so users can see rebuilds and timing,
        // even on success. Machine output moves it off stdout, not away.
        humanLine(line)
      } catch {
        // best-effort: never throw from logging
      }
    })
  }
}
