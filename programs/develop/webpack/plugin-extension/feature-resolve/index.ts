import * as path from 'path'
import type {Compiler} from '@rspack/core'
import type {PluginInterface} from '../../webpack-types'
import * as messages from './messages'

export class ResolvePlugin {
  public readonly manifestPath: string
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    compiler.options.module.rules.push({
      test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [path.dirname(this.manifestPath)],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: path.resolve(__dirname, 'resolve-paths-loader'),
          options: {
            manifestPath: this.manifestPath,
            packageJsonDir: compiler.options.context,
            // Provide the final output directory so the loader can display
            // NOT FOUND paths according to ERROR_POLICY (outputRoot + strippedPath)
            outputPath: compiler.options.output?.path,
            browser: this.browser,
            mode: compiler.options.mode || 'development'
          }
        }
      ]
    })
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        messages.resolveAttachSummary(
          String(this.browser || 'chrome'),
          path.dirname(this.manifestPath),
          String(compiler.options.mode || 'development')
        )
      )
    }
  }
}
