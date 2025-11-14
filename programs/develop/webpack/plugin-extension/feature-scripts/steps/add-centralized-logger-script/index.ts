import * as path from 'path'
import {type Compiler} from '@rspack/core'
import type {
  FilepathList,
  PluginInterface,
  DevOptions
} from '../../../../webpack-types'

export class AddCentralizedLoggerScript {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    compiler.options.module.rules.push({
      enforce: 'pre',
      test: /(\.m?[jt]sx?)$/,
      include: [path.dirname(this.manifestPath)],
      exclude: [/[/\\]node_modules[/\\]/],
      use: [
        {
          loader: path.resolve(
            __dirname,
            'add-centralized-logger-script-content'
          ),
          options: {
            manifestPath: this.manifestPath,
            browser: this.browser
          }
        },
        {
          loader: path.resolve(
            __dirname,
            'add-centralized-logger-script-background'
          ),
          options: {
            manifestPath: this.manifestPath,
            browser: this.browser
          }
        }
      ]
    })
  }
}
