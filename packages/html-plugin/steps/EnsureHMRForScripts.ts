import path from 'path'
import type webpack from 'webpack'

import {type IncludeList, type StepPluginInterface} from '../types'

export default class EnsureHMRForScripts {
  public readonly manifestPath: string
  public readonly includeList: IncludeList
  public readonly exclude: string[]

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.exclude = options.exclude || []
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.options.module.rules.push({
      test: /\.(t|j)sx?$/,
      use: [
        {
          loader: path.resolve(__dirname, './loaders/InjectHmrAcceptLoader'),
          options: {
            manifestPath: this.manifestPath,
            exclude: this.exclude,
            includeList: this.includeList
          }
        }
      ]
    })
  }
}
