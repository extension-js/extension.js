import path from 'path'
import webpack from 'webpack'

import {type HtmlPluginInterface} from '../types'

export default class EnsureHMRForScripts {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
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
            exclude: this.exclude
          }
        }
      ]
    })
  }
}
