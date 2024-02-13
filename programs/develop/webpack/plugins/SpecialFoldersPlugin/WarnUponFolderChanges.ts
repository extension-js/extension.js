import * as path from 'path'
import * as chokidar from 'chokidar'
import webpack from 'webpack'
import {Compilation, Compiler, WebpackError} from 'webpack'

class WatchPagesPlugin {
  private manifestPath: string

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath
  }

  private xxxxxx(compiler: webpack.Compiler) {
    const webpackCompiler = webpack({
      ...compiler.options,
      output: {
        ...compiler.options.output,
        uniqueName: 'browser-extension-manifest-plugin'
      },
      plugins: [
        ...compiler.options.plugins.filter((data) => {
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
  }
  private warningMessage(folder: string) {
    const typeOfAsset = folder === 'pages' ? 'HTML pages' : 'Script files'
    const warningMessage =
      `⚠️ extension-create ►►► Adding new ${typeOfAsset} after compilation ` +
      'requires a server restart. Restart the program to see changes.'

    console.warn(warningMessage)
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.afterPlugins.tap('WatchPagesPlugin', () => {
      const projectPath: string = path.dirname(this.manifestPath)
      const pagesPath: string = path.join(projectPath, 'pages')

      const watcher = chokidar.watch(pagesPath, {
        ignoreInitial: true
      })

      watcher.on('add', (filePath: string) => {
        console.log('File added::::::', filePath)
        this.warningMessage('pages')
      })

      watcher.on('unlink', (filePath: string) => {
        console.log('File removed::::::', filePath)
        this.warningMessage('pages')
      })

      compiler.hooks.watchClose.tap('WatchPagesPlugin', () => {
        watcher.close()
      })
    })
  }
}

export default WatchPagesPlugin
