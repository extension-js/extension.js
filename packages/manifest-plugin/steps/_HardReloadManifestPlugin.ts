import path from 'path'
import webpack from 'webpack'

interface Options {
  manifestPath: string
}

export default class HardReloadManifestPlugin {
  private readonly options: Options
  private readonly logger: any // WebpackLogger

  constructor(options: Options) {
    this.options = options
  }

  apply(compiler: webpack.Compiler): void {
    // this.logger = compiler.getInfrastructureLogger('webpack-cli')

    compiler.hooks.watchRun.tapAsync(
      'ManifestPlugin (HardReloadManifest)',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set()
        const changedFile = files.values().next().value

        if (!changedFile || path.basename(changedFile) !== 'manifest.json') {
          done()
          return
        }

        compiler.hooks.afterCompile.tap(
          'ManifestPlugin (HardReloadManifest)',
          (compilation) => {
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
                    (data as any)?.name !== 'browserPlugins' &&
                    (data as any)?.name !== 'reloadPlugins'
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
          }
        )
        done()
      }
    )
  }
}
