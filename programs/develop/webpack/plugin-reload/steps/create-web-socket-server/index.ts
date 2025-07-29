import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {PluginInterface} from '../../reload-types'
import {messageDispatcher} from './web-socket-server/message-dispatcher'
import {startServer} from './web-socket-server/start-server'
import {EnhancedReloadService} from './web-socket-server/enhanced-reload-service'
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
  private readonly instanceId?: string
  private enhancedReloadService: EnhancedReloadService | null = null

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.port = options.port || 8080
    this.browser = options.browser || 'chrome'
    this.stats = options.stats
    this.instanceId = options.instanceId
  }

  async apply(compiler: Compiler) {
    if (!this.manifestPath) return

    // Initialize enhanced reload service
    const extensionPath = path.dirname(compiler.options.output?.path as string)
    this.enhancedReloadService = new EnhancedReloadService({
      browser: this.browser,
      extensionPath,
      port: this.port,
      instanceId: this.instanceId
    })

    await this.enhancedReloadService.initialize()

    // Start webSocket server to communicate with the extension.
    const wss = await startServer(compiler, {
      ...this,
      mode: compiler.options.mode,
      browser: this.browser,
      stats: this.stats,
      port: this.port
    })

    compiler.hooks.watchRun.tapAsync(
      'reload:create-web-socket-server',
      async (compiler, done) => {
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
          // Use enhanced reload service for critical files
          if (this.enhancedReloadService) {
            await this.enhancedReloadService.reloadExtension(changedFile)
          }

          // Also dispatch WebSocket message for non-critical files
          messageDispatcher(wss, this.manifestPath, changedFile)
        }
        done()
      }
    )
  }
}
