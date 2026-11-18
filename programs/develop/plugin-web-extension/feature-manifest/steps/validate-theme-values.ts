// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {Compilation, type Compiler} from '@rspack/core'
import {
  isChromiumBasedBrowser,
  isWebkitBasedBrowser
} from '../../../lib/constants'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {reportToCompilation} from '../../shared/compilation-issues'
import {collectThemeArrayIssues} from '../manifest-lib/theme-values'
import * as messages from '../messages'

export class ValidateThemeArrays {
  public static readonly name: string = 'manifest:validate-theme-values'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    const browserName = String(this.browser)
    const webkitTarget = isWebkitBasedBrowser(browserName)

    // Firefox parses theme colors with its own schema (CSS strings included),
    // so only the Chromium family gets Chromium's number-array contract.
    // Safari has no theme surface at all, which deserves a warning, not silence.
    if (!isChromiumBasedBrowser(browserName) && !webkitTarget) return

    compiler.hooks.thisCompilation.tap(
      ValidateThemeArrays.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: ValidateThemeArrays.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            let manifest: Manifest

            try {
              manifest = filterKeysForThisBrowser(
                parseJsonSafe(fs.readFileSync(this.manifestPath, 'utf8')),
                this.browser
              )
            } catch {
              return
            }

            if (webkitTarget) {
              if ((manifest as Record<string, unknown>).theme) {
                reportToCompilation(
                  compilation,
                  compiler,
                  messages.themeNotSupportedByBrowser(browserName),
                  'warning',
                  'manifest.json'
                )
              }

              return
            }

            const issues = collectThemeArrayIssues(manifest)

            if (issues.length > 0) {
              reportToCompilation(
                compilation,
                compiler,
                messages.themeArraysRefused(browserName, issues),
                'error',
                'manifest.json',
                'ThemeArrayInvalid'
              )
            }
          }
        )
      }
    )
  }
}
