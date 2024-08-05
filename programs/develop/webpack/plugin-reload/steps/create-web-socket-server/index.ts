import path from 'path'
import {type Compiler} from 'webpack'
import {PluginInterface} from '../../reload-types'
import {messageDispatcher} from './web-socket-server/message-dispatcher'
import {startServer} from './web-socket-server/start-server'
import {replaceDataInFile} from './rewrite-reload-port'
import {DevOptions} from '../../../../module'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export default class CreateWebSocketServer {
  private readonly manifestPath: string
  private readonly port: number
  private readonly browser: DevOptions['browser']
  private readonly stats: boolean | undefined

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.port = options.port || 8000
    this.browser = options.browser || 'chrome'
    this.stats = options.stats
  }

  apply(compiler: Compiler) {
    if (!this.manifestPath) return

    // Before all, rewrite the reload service file
    // with the user-provided port.
    replaceDataInFile(this.port)

    // Start webSocket server to communicate with the extension.
    const wss = startServer(compiler, {
      ...this,
      mode: compiler.options.mode,
      browser: this.browser,
      stats: this.stats
    })

    compiler.hooks.watchRun.tapAsync(
      'reload:create-web-socket-server',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set()
        const changedFile: string | undefined = files.values().next().value

        if (!changedFile) {
          done()
          return
        }

        const relativePath = path.relative(
          path.dirname(this.manifestPath),
          changedFile
        )

        const context = path.relative(process.cwd(), path.dirname(changedFile))
        if (process.env.EXTENSION_ENV === 'development') {
          console.info(
            `►► Updated file \`${relativePath}\` (relative to ${context})`
          )
        }

        if (this.manifestPath) {
          messageDispatcher(wss, this.manifestPath, changedFile)
        }
        done()
      }
    )
  }
}
