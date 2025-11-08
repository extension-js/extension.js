// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import colors from 'pintor'
import {Compiler} from '@rspack/core'
import * as messages from './compilation-lib/messages'

import {type PluginInterface} from '../webpack-types'

export class BoringPlugin {
  public static readonly name: string = 'plugin-boring'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.done.tapAsync('develop:brand', (stats, done) => {
      stats.compilation.name = undefined
      const duration = stats.compilation.endTime! - stats.compilation.startTime!
      const manifestName = JSON.parse(
        fs.readFileSync(this.manifestPath, 'utf-8')
      ).name
      const line = messages.boring(manifestName, duration, stats)
      // Always print a fresh line per compilation; do not rewrite or buffer.
      // eslint-disable-next-line no-console
      console.log(line)
      done()
    })
  }
}
