//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler, Stats} from '@rspack/core'
import {humanLine} from '../dev-server/lifecycle-stream'
import {resolveLocalizedManifestName} from '../lib/localized-manifest-name'
import {parseJsonSafe} from '../lib/parse-json-safe'
import {isInsidePath, isSameOrInsidePath} from '../lib/real-path'
import {isEmitTimeWarning} from '../lib/stats-handler'
import type {PluginInterface} from '../types'
import * as messages from './compilation-lib/messages'

// Past every stage a plugin picks, so the line is the last word of the hook.
const LAST_TAP_STAGE = 2147483647

// Read when the line prints, so a finding a done tap added is counted too.
function countDiagnostics(stats: Stats): {
  errors: number
  warnings: number
  warningsAtEmit: number
} {
  try {
    const info = stats.toJson({all: false, errors: true, warnings: true})
    const warnings = info.warnings || []

    return {
      errors: (info.errors || []).length,
      warnings: warnings.length,
      warningsAtEmit: warnings.filter((warning) => isEmitTimeWarning(warning))
        .length
    }
  } catch {
    // A stats object with no lists still says whether it has any.
    return {
      errors: stats?.hasErrors?.() ? 1 : 0,
      warnings: stats?.hasWarnings?.() ? 1 : 0,
      warningsAtEmit: 0
    }
  }
}

export interface BoringPluginOptions extends PluginInterface {
  browserLaunchEnabled?: boolean
  // True when the caller prints the diagnostics after the done hook returns.
  diagnosticsFollow?: boolean
}

export class BoringPlugin {
  public static readonly name: string = 'plugin-boring'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  private readonly browserLaunchEnabled: boolean
  private readonly diagnosticsFollow: boolean
  private sawUserInvalidation = false
  private printedStartupSuccess = false
  private printedStartupWarning = false
  private lastKnownManifestName?: string

  constructor(options: BoringPluginOptions) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    // Told by the caller, so one session's setting never reaches another compile.
    this.browserLaunchEnabled = options.browserLaunchEnabled !== false
    this.diagnosticsFollow = options.diagnosticsFollow === true
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.watchClose.tap('develop:brand:watch-close', () => {
      this.sawUserInvalidation = false
      this.printedStartupSuccess = false
      this.printedStartupWarning = false
    })

    // A build's line runs last, so a tap that fails the build is counted or
    // ends the hook before a line that reads as success is printed.
    const tap = this.diagnosticsFollow
      ? {name: 'develop:brand', stage: LAST_TAP_STAGE}
      : 'develop:brand'

    compiler.hooks.done.tap(tap, (stats) => {
      const counts = countDiagnostics(stats)
      const hasErrors = counts.errors > 0
      const hasWarnings = counts.warnings > 0
      const browserLaunchEnabled = this.browserLaunchEnabled

      stats.compilation.name = undefined
      const duration = stats.compilation.endTime! - stats.compilation.startTime!
      // A throw here escapes hooks.done into Watching._done and kills the watch loop
      // (a mid-save manifest is routinely invalid JSON); never propagate.
      let manifestName: string | undefined

      try {
        // The emitted manifest has its $EXTENSION_PUBLIC_* values filled, so
        // the line names what ships. The source stands in when none was emitted.
        const emitted = stats.compilation
          .getAsset?.('manifest.json')
          ?.source.source()
        // A __MSG_ name reads as the default locale's value, the way the
        // browser shows it, instead of the key.
        const parsedName = resolveLocalizedManifestName(
          parseJsonSafe(
            emitted
              ? String(emitted)
              : fs.readFileSync(this.manifestPath, 'utf-8')
          ),
          [
            path.dirname(this.manifestPath),
            String(compiler.options?.context || '')
          ]
        )

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

      // Warnings a plugin printed at emit sit above the line, the rest below.
      const warningsListed = !this.diagnosticsFollow
        ? undefined
        : counts.warningsAtEmit === 0
          ? 'below'
          : counts.warningsAtEmit < counts.warnings
            ? 'above and below'
            : undefined

      const line = messages.boring(manifestName || 'Extension', duration, {
        errors: counts.errors,
        warnings: counts.warnings,
        warningsListed
      })

      let repeatsStartupLine = false

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
            root !== '' && isSameOrInsidePath(root, file)
          const hasUserFileChange = modifiedFiles.some((file) => {
            const inProject = !context || isInsidePath(context, file)
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
            repeatsStartupLine = this.printedStartupWarning
            this.printedStartupWarning = true
          } else {
            repeatsStartupLine = this.printedStartupSuccess
            this.printedStartupSuccess = true
          }
        }
      } catch {
        // A compile whose changed files cannot be read still gets its line.
        repeatsStartupLine = false
      }

      if (repeatsStartupLine) return

      // Always print the boring line so users can see rebuilds and timing,
      // even on success. Machine output moves it off stdout, not away.
      humanLine(line)
    })
  }
}
