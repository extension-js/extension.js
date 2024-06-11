import path from 'path'
import {type Compiler} from 'webpack'
import {type RunFirefoxExtensionInterface} from '../../types'
import {type ManifestBase} from '../../manifest-types'
import messageDispatcher from './webSocketServer/messageDispatcher'
import startServer from './webSocketServer/startServer'
import rewriteReloadPort from './rewriteReloadPort'
import rewriteFirstRunVariable from './rewriteFirstRunVariable'
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

    // And also rewrite the first run variable.
    // This will change the user active tab on first run.
    rewriteFirstRunVariable()

    // The initial stdout of this plugin where the extension info is provided
    // is handled by the reload service. However Firefox requires a secure connection
    // to authorize the websocket message passing. In this case, show a hardcoded
    // message with the extension data for the first run, and inform users that they
    // can run a command like `npx mkcert-cli` to create a certificate for the extension.
    if (isFirstRun()) {
      const manifest: ManifestBase = require(this.options.manifestPath)

      setTimeout(() => {
        const hardcodedMessage = {
          data: {
            id: manifest.browser_specific_settings?.gecko?.id,
            manifest,
            management: {
              id: manifest.browser_specific_settings?.gecko?.id,
              mayDisable: true,
              optionsUrl: '',
              installType: 'development' as 'development',
              type: 'extension' as 'extension',
              enabled: true,
              name: manifest.name,
              description: manifest.description || '',
              version: manifest.version,
              hostPermissions: manifest.host_permissions,
              permissions: manifest.permissions
            }
          }
        }

        if (this.options.stats === true) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          messages.extensionData(compiler, hardcodedMessage, true)
        }

        messages.stdoutData(compiler, hardcodedMessage)

        if (this.options.stats === true) {
          // Add a delay to ensure the message is sent
          // after other runner messages.
          setTimeout(() => {
            messages.isFirstRun()
          }, 2500)
        }
      }, 6000)
    }

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
