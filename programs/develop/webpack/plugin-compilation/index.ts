import * as fs from 'fs'
import colors from 'pintor'
import {Compiler, DefinePlugin} from '@rspack/core'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {EnvPlugin} from './env'
import * as messages from './compilation-lib/messages'
import {CleanDistFolderPlugin} from './clean-dist'
// Local compact build summary helper
function formatBuildSummary(
  manifestName: string,
  durationMs: number,
  hasErrors: boolean
) {
  const arrow = hasErrors ? colors.red('✖✖✖') : colors.green('►►►')
  return `${arrow} ${manifestName} compiled ${hasErrors ? colors.red('with errors') : colors.green('successfully')} in ${durationMs} ms.`
}
import {type PluginInterface} from '../webpack-types'

// Track repeated "boring" messages and collapse them into a single line with a counter
let lastCompilationKey: string | null = null
let repeatCompilationCount = 0
let printedFirstCompilation = false

function getCompilationKey(manifestName: string, hasErrors: boolean): string {
  // Keep the key stable across quick refreshes by ignoring duration
  return `${manifestName}|${hasErrors ? 'errors' : 'ok'}`
}

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  public readonly clean: boolean

  constructor(options: PluginInterface & {clean: boolean}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.clean = options.clean ?? true
  }

  public apply(compiler: Compiler): void {
    // TODO: This is outdated
    new CaseSensitivePathsPlugin().apply(compiler as any)

    new EnvPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser
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

    const logger = compiler.getInfrastructureLogger('plugin-compilation')

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

      // If message repeats, overwrite previous compilation line and append (Nx)
      if (key === lastCompilationKey) {
        repeatCompilationCount += 1
        const suffix = colors.gray(` (${repeatCompilationCount}x) `)
        logger.info(line + suffix)
      } else {
        // New key: reset counter and print fresh line with newline
        lastCompilationKey = key
        repeatCompilationCount = 1

        // Do not insert extra blank lines; keep messages sequential
        if (!printedFirstCompilation) {
          printedFirstCompilation = true
        }
        logger.info(line)
      }

      done()
    })
  }
}
