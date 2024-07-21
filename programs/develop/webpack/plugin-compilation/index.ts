import {PathData, Compiler} from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {EnvPlugin} from './env'
import {CleanHotUpdatesPlugin} from './clean-hot-updates'
import * as messages from '../../lib/messages'

import {type PluginInterface} from '../../types'

export class CompilationPlugin {
  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  public apply(compiler: Compiler): void {
    new MiniCssExtractPlugin({
      chunkFilename: (pathData: PathData) => {
        const runtime = (pathData.chunk as any)?.runtime
        return `${runtime}/[name].css`
      }
    }).apply(compiler)

    new CaseSensitivePathsPlugin().apply(compiler)

    new EnvPlugin({manifestPath: this.manifestPath}).apply(compiler)

    new CleanHotUpdatesPlugin().apply(compiler)

    compiler.hooks.done.tap('develop:brand', (stats) => {
      stats.compilation.name = `${messages.boring(stats)}`
    })
  }
}
