import path from 'path'
import webpack from 'webpack'

interface Options {
  manifestPath: string
}

export default class RecompileWebpackPlugin {
  private readonly options: Options
  private readonly logger: any // WebpackLogger

  constructor(options: Options) {
    this.options = options
  }

  apply(compiler: webpack.Compiler): void {
    // this.logger = compiler.getInfrastructureLogger('webpack-cli')

    compiler.hooks.watchRun.tapAsync('RecompileWebpack', (compiler, done) => {
      const files = compiler.modifiedFiles || new Set()
      const changedFile = files.values().next().value

      if (!changedFile || path.basename(changedFile) !== 'manifest.json') {
        done()
        return
      }

      compiler.hooks.afterCompile.tap('RecompileWebpack', (compilation) => {
        if (
          compilation.errors?.length > 0 ||
          compilation.warnings?.length > 0
        ) {
          return
        }

        const webpackCompiler = webpack({
          ...compilation.options,
          output: {
            ...compilation.options.output,
            uniqueName: 'browser-extension-manifest-plugin'
          },
          plugins: [
            ...compilation.options.plugins.filter((data) => {
              return (
                (data as any)?.name !== 'BrowserPlugins' &&
                (data as any)?.name !== 'ReloadPlugins'
              )
            })
          ]
        } as any)

        webpackCompiler.run((err, stats) => {
          if (err) {
            console.error(err)
            return
          }

          console.log('-----------------------------------')
        })
      })
      done()
    })
  }
}
