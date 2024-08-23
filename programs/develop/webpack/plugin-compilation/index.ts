import {Compiler} from '@rspack/core'
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
    new EnvPlugin({manifestPath: this.manifestPath}).apply(compiler)

    new CleanHotUpdatesPlugin().apply(compiler)

    compiler.hooks.done.tap('develop:brand', (stats) => {
      stats.compilation.name = undefined

      // Calculate compilation time
      const duration =
        (stats.compilation.endTime || 0) - (stats.compilation.startTime || 0)

      const manifestName = require(this.manifestPath).name
      console.log(messages.boring(manifestName, duration, stats))
    })
  }
}
