import * as path from 'path'
import type {Compiler} from '@rspack/core'
import type {PluginInterface} from '../../webpack-types'

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
            browser: this.browser,
            mode: compiler.options.mode || 'development'
          }
        }
      ]
    })
  }
}
