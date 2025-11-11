// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import {Compiler} from '@rspack/core'
import * as messages from './compilation-lib/messages'

import {type PluginInterface} from '../webpack-types'

function readJsonFileSafe(filePath: string) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return JSON.parse(text)
}

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
      const manifestName = readJsonFileSafe(this.manifestPath).name
      const line = messages.boring(manifestName, duration, stats)
      // Success lines are no longer printed to console/stdout.
      // Only emit via infrastructure logger when there are errors.
      console.log(line)

      done()
    })
  }
}
