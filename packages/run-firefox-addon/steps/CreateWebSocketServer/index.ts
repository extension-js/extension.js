import path from 'path'
import {type Compiler} from 'webpack'
import {type RunFirefoxExtensionInterface} from '../../types'
import {type ManifestBase} from '../../manifest-types'
import messageDispatcher from './webSocketServer/messageDispatcher'
import startServer from './webSocketServer/startServer'
import rewriteReloadPort from './rewriteReloadPort'
import messages from '../../helpers/messages'
import isFirstRun from '../RunFirefoxPlugin/firefox/isFirstRun'

export default class CreateWebSocketServer {
  private readonly options: RunFirefoxExtensionInterface

  constructor(options: RunFirefoxExtensionInterface) {
    this.options = options
  }

  apply(compiler: Compiler) {
    if (!this.options.manifestPath) return

    // Before all, rewrite the reload service file
    // with the user-provided port.
    rewriteReloadPort(this.options.port || 8002)

    // Start webSocket server to communicate with the extension.
    const wss = startServer(compiler, this.options)

    compiler.hooks.watchRun.tapAsync(
      'RunFirefoxExtensionPlugin (CreateWebSocketServer)',
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
