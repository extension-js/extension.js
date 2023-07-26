import path from 'path'
import {type Compiler} from 'webpack'
// import manifestFields from 'browser-extension-manifest-fields'
import {type RunChromeExtensionInterface} from '../../types'
import messageDispatcher from './webSocketServer/messageDispatcher'
import startServer from './webSocketServer/startServer'
import rewriteReloadPort from './rewriteReloadPort'
import AddDependenciesPlugin from '../AddDependenciesPlugin'

export default class SimpleReloadPlugin {
  private readonly options: RunChromeExtensionInterface

  constructor(options: RunChromeExtensionInterface) {
    this.options = options
  }

  apply(compiler: Compiler) {
    if (!this.options.manifestPath) return
    if (!this.options.autoReload) return

    // Before all, rewrite the reload service file
    // with the user-provided port.
    rewriteReloadPort(this.options.port!)

    // Start webSocket server to communicate
    // with the extension.
    const wss = startServer(this.options.port)

    compiler.hooks.watchRun.tapAsync(
      'RunChromeExtensionPlugin',
      (compilation, done) => {
        const files = compilation.modifiedFiles || new Set()
        const changedFile = files.values().next().value

        if (!changedFile) {
          done()
          return
        }

        console.info('[Reload Service] Updates on:', path.basename(changedFile))

        if (this.options.manifestPath) {
          messageDispatcher(wss, this.options, changedFile)
        }
        done()
      }
    )

    new AddDependenciesPlugin({
      manifestPath: this.options.manifestPath
    }).apply(compiler)
  }
}
