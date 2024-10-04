import path from 'path'
import {Compiler} from 'webpack'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin'
import {EnvPlugin} from './env'
import {CleanDistFolderPlugin} from './clean-dist'
import * as messages from '../lib/messages'

import {type PluginInterface} from '../webpack-types'

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    // TODO: This is outdated
    new CaseSensitivePathsPlugin().apply(compiler as any)

    new EnvPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    compiler.options.resolve.plugins = [
      new TsconfigPathsPlugin({
        configFile: path.resolve(
          path.dirname(this.manifestPath),
          'tsconfig.json'
        )
      })
    ]

    new CleanDistFolderPlugin().apply(compiler)

    compiler.hooks.done.tap('develop:brand', (stats) => {
      stats.compilation.name = undefined

      // Calculate compilation time
      const duration = stats.endTime - stats.startTime

      const manifestName = require(this.manifestPath).name
      console.log(messages.boring(manifestName, duration, stats))
    })
  }
}
