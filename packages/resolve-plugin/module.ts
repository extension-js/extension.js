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
    const resolverModulePath = path.resolve(
      __dirname,
      './resolver-module/index.js'
    )

    // {
    //   assetName: 'manifest.json'
    // }
    // {
    //   assetName: 'devtools_page/index.js'
    // }
    // {
    //   assetName: 'service_worker/script.js'
    // }
    // {
    //   assetName: 'devtools_page/index.html'
    // }

    // compiler.hooks.thisCompilation.tap(
    //   'ResolverModulePlugin',
    //   (compilation) => {
    //     compilation.hooks.processAssets.tap(
    //       {
    //         name: 'ResolverModulePlugin',
    //         stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
    //       },
    //       (assets) => {
    //         for (const assetName in assets) {
    //           if (['.ts', '.js', '.tsx', '.jsx'].includes(path.extname(assetName))) {
    //             const asset = assets[assetName]
    //             console.log({assetName})
    //             const importString = `;import r from 'resolver-module/index.js';\n`
    //             const newSource = new webpack.sources.ConcatSource(
    //               importString,
    //               asset
    //             )

    //             assets[assetName] = newSource
    //           }
    //         }
    //       }
    //     )
    //   }
    // )

    // 1 - Add the resolver module to the bundle.
    // This is the file that will be used by the browser
    // extension to resolve the API methods.
    // new webpack.ProvidePlugin({
    //   r: require.resolve(path.resolve(__dirname, './resolver-module/index.js'))
    // }).apply(compiler)

    // console.log({resolverModulePath})
    // compiler.options.entry = {
    //   ...compiler.options.entry,
    //   'resolver-module': {
    //     import: [resolverModulePath]
    //   }
    // }

    // compiler.options.resolve = {
    //   ...compiler.options.resolve,
    //   alias: {
    //     ...compiler.options.resolve.alias,
    //     'resolver-module': resolverModulePath
    //   }
    // }

    const stdLibBrowser = require('node-stdlib-browser')

    new webpack.ProvidePlugin({
      process: stdLibBrowser.process,
      fs: stdLibBrowser.fs,
      path: stdLibBrowser.path
    }).apply(compiler)

    compiler.options.resolve.alias = stdLibBrowser
    // compiler.options.module?.rules.push({
    //   // You can use `regexp`
    //   test: /\.(t|j)sx?$/,
    //   use: [
    //     {
    //       loader: 'imports-loader',
    //       options: {
    //         imports: ['default resolver-module r']
    //       }
    //     }
    //   ]
    // })

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
