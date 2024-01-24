import path from 'path'
import {type Compiler} from 'webpack'
import {type RunChromeExtensionInterface} from '../../../types'
import messageDispatcher from './webSocketServer/messageDispatcher'
import startServer from './webSocketServer/startServer'
import rewriteReloadPort from './rewriteReloadPort'

export default class CreateWebSocketServer {
  private readonly options: RunChromeExtensionInterface

  constructor(options: RunChromeExtensionInterface) {
    this.options = options
  }

  apply(compiler: Compiler) {
    if (!this.options.manifestPath) return

    // Before all, rewrite the reload service file
    // with the user-provided port.
    rewriteReloadPort(this.options.port)

    // Start webSocket server to communicate with the extension.
    const wss = startServer(compiler, this.options.port)

    compiler.hooks.watchRun.tapAsync(
      'RunChromeExtensionPlugin (CreateWebSocketServer)',
      (compilation, done) => {
        const files = compilation.modifiedFiles || new Set()
        const changedFile = files.values().next().value

        if (!changedFile) {
          done()
          return
        }

        console.info(
          '[-] Updates on: ',
          path.relative(
            path.dirname(this.options.manifestPath || ''),
            changedFile
          )
        )

        if (this.options.manifestPath) {
          messageDispatcher(wss, this.options, changedFile)
        }
        done()
      }
    )
  }
}
