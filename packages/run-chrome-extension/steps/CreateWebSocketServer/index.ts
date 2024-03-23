import path from 'path'
import {type Compiler} from 'webpack'
import {type RunChromeExtensionInterface} from '../../types'
import messageDispatcher from './webSocketServer/messageDispatcher'
import startServer from './webSocketServer/startServer'
import rewriteReloadPort from './rewriteReloadPort'
import rewriteFirstRunVariable from './rewriteFirstRunVariable'

export default class CreateWebSocketServer {
  private readonly options: RunChromeExtensionInterface

  constructor(options: RunChromeExtensionInterface) {
    this.options = options
  }

  apply(compiler: Compiler) {
    if (!this.options.manifestPath) return

    // Before all, rewrite the reload service file
    // with the user-provided port.
    rewriteReloadPort(this.options.port || 8000)

    // And also rewrite the first run variable.
    // This will change the user active tab on first run.
    rewriteFirstRunVariable()

    // Start webSocket server to communicate with the extension.
    const statConfig = this.options.stats
    const wss = startServer(compiler, statConfig, this.options.port)

    compiler.hooks.watchRun.tapAsync(
      'RunChromeExtensionPlugin (CreateWebSocketServer)',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set()
        const changedFile: string | undefined = files.values().next().value

        if (!changedFile) {
          done()
          return
        }

        const relativePath = path.relative(
          path.dirname(this.options.manifestPath || ''),
          changedFile
        )

        const context = path.relative(process.cwd(), path.dirname(changedFile))
        if (process.env.EXTENSION_ENV === 'development') {
          console.info(
            `►► Updated file \`${relativePath}\` (relative to ${context})`
          )
        }

        if (this.options.manifestPath) {
          messageDispatcher(wss, this.options, changedFile)
        }
        done()
      }
    )
  }
}
