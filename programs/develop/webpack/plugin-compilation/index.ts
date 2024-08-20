import {Compiler} from 'webpack'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {EnvPlugin} from './env'
import {CleanHotUpdatesPlugin} from './clean-hot-updates'
import * as messages from '../lib/messages'

import {type PluginInterface} from '../webpack-types'

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  public apply(compiler: Compiler): void {
    new CaseSensitivePathsPlugin().apply(compiler)

    new EnvPlugin({manifestPath: this.manifestPath}).apply(compiler)

    new CleanHotUpdatesPlugin().apply(compiler)

    compiler.hooks.done.tap('develop:brand', (stats) => {
      stats.compilation.name = undefined

      // Calculate compilation time
      const duration = stats.endTime - stats.startTime

      console.log(messages.boring(duration, stats))
    })
  }
}
