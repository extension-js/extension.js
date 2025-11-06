// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'node:readline'
import colors from 'pintor'
import {Compiler, DefinePlugin} from '@rspack/core'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {EnvPlugin} from './env'
import * as messages from './compilation-lib/messages'
import {
  isBannerPrinted,
  setPendingCompilationLine,
  sharedState
} from '../webpack-lib/shared-state'
import {CleanDistFolderPlugin} from './clean-dist'
import {ZipPlugin} from './plugin-zip'
// no shared banner gating; boring plugin will overwrite initial placeholder from banner

import {type PluginInterface} from '../webpack-types'

// Track repeated "boring" messages and collapse them into a single line with a counter
let lastCompilationKey: string | null = null
let repeatCompilationCount = 0
let printedFirstCompilation = false
let lastPrintedWasBoring = false

function getCompilationKey(manifestName: string, hasErrors: boolean): string {
  // Keep the key stable across quick refreshes by ignoring duration
  return `${manifestName}|${hasErrors ? 'errors' : 'ok'}`
}

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  public readonly clean: boolean
  public readonly zip?: boolean
  public readonly zipSource?: boolean
  public readonly zipFilename?: string

  constructor(
    options: PluginInterface & {clean: boolean} & {
      zip?: boolean
      zipSource?: boolean
      zipFilename?: string
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.clean = options.clean ?? true
    this.zip = options.zip
    this.zipSource = options.zipSource
    this.zipFilename = options.zipFilename
  }

  public apply(compiler: Compiler): void {
    // TODO: This is outdated
    new CaseSensitivePathsPlugin().apply(compiler as any)

    new EnvPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)

    // The CleanDistFolderPlugin will remove the dist folder
    // before the compilation starts. This is a problem
    // for preview mode, where we don't want to clean the
    // folder that is being used by the preview server.
    if (this.clean) {
      new CleanDistFolderPlugin({
        browser: this.browser || 'chrome'
      }).apply(compiler)
    }

    new DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(
        compiler.options.mode || 'development'
      )
    })

    // Register packaging only for production builds when requested
    if (
      (this.zip || this.zipSource) &&
      compiler.options.mode === 'production'
    ) {
      new ZipPlugin({
        manifestPath: this.manifestPath,
        browser: this.browser || 'chrome',
        zipData: {
          zip: this.zip,
          zipSource: this.zipSource,
          zipFilename: this.zipFilename
        }
      }).apply(compiler)
    }

    compiler.hooks.done.tapAsync('develop:brand', (stats, done) => {
      stats.compilation.name = undefined

      // Calculate compilation time
      const duration = stats.compilation.endTime! - stats.compilation.startTime!

      const manifestName = JSON.parse(
        fs.readFileSync(this.manifestPath, 'utf-8')
      ).name

      const hasErrors = stats.hasErrors()
      const key = getCompilationKey(manifestName, hasErrors)
      const line = messages.boring(manifestName, duration, stats)

      // If banner printed after we buffered, flush pending now
      if (
        isBannerPrinted() &&
        sharedState.pendingCompilationLine &&
        !lastPrintedWasBoring
      ) {
        // eslint-disable-next-line no-console
        console.log(sharedState.pendingCompilationLine)
        sharedState.pendingCompilationLine = ''
        lastCompilationKey = key
        repeatCompilationCount = 1
        lastPrintedWasBoring = true
      }

      // If message repeats, overwrite previous compilation line and append (Nx)
      const printedBanner = isBannerPrinted()

      if (key === lastCompilationKey && printedBanner) {
        repeatCompilationCount += 1
        const suffix = colors.gray(` (${repeatCompilationCount}x) `)
        const text = line + suffix

        if (lastPrintedWasBoring) {
          try {
            // Move up to previous boring line, clear it, and rewrite with newline
            readline.moveCursor(process.stdout, 0, -1)
            readline.clearLine(process.stdout, 0)
            readline.cursorTo(process.stdout, 0)
            process.stdout.write(text + '\n')
          } catch {
            // eslint-disable-next-line no-console
            console.log(text)
          }
        } else {
          // eslint-disable-next-line no-console
          console.log(text)
        }
        lastPrintedWasBoring = true
      } else {
        // New key: reset counter and (optionally) print fresh line
        lastCompilationKey = key
        repeatCompilationCount = 1

        // Do not insert extra blank lines. Keep messages sequential
        if (!printedFirstCompilation) {
          printedFirstCompilation = true
        }

        if (printedBanner) {
          // Ensure we start a fresh line before starting counters
          if (lastPrintedWasBoring) readline?.clearLine(process.stdout, 0)
          console.log(line)
          lastPrintedWasBoring = true
        } else setPendingCompilationLine(line)
      }

      done()
    })
  }
}
