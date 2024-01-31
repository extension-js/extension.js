import path from 'path'
import webpack, {Compilation} from 'webpack'
import {ResolvePluginInterface} from './types'
import {ConcatSource} from 'webpack-sources'

export default class ResolvePlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: ResolvePluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
  }

  /**
   * ResolvePlugin is responsible for resolving paths for
   * specific browser extension api calls.
   */
  public apply(compiler: webpack.Compiler): void {
    const stdLibBrowser = require('node-stdlib-browser')

    new webpack.ProvidePlugin({
      process: stdLibBrowser.process,
      fs: stdLibBrowser.fs,
      path: stdLibBrowser.path
    }).apply(compiler)

    compiler.options.resolve.alias = stdLibBrowser

    // 2 - Add the resolver loader.
    // This loader will be used to transform the API methods
    // to use the resolver module.
    compiler.options.module?.rules.push({
      test: /\.(t|j)sx?$/,
      loader: require.resolve(path.resolve(__dirname, './loader/index.js')),
      options: {
        manifestPath: this.manifestPath,
        exclude: this.exclude
      }
    })
  }
}
