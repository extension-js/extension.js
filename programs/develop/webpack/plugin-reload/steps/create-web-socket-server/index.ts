import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {PluginInterface} from '../../reload-types'
import {messageDispatcher} from './web-socket-server/message-dispatcher'
import {startServer} from '../../start-server'
import * as messages from '../../reload-lib/messages'

export default class CreateWebSocketServer {
  private readonly manifestPath: string
  private readonly port: number
  private readonly browser: string
  private readonly stats: boolean | undefined
  private readonly instanceId?: string
  private webSocketServer: any = null
  private isServerInitialized = false

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.port = options.port || 8080
    this.browser = options.browser || 'chrome'
    this.stats = options.stats
    this.instanceId = options.instanceId
  }

  async initializeServer(compiler: Compiler): Promise<void> {
    // Check if server already exists and is working
    if (this.webSocketServer && this.isServerInitialized) {
      return
    }

    // Double-check to prevent race conditions
    if (this.isServerInitialized) {
      return
    }

    try {
      this.webSocketServer = await startServer(compiler, {
        browser: this.browser as any,
        mode: compiler.options.mode || 'development'
      })
      this.isServerInitialized = true
      console.log(messages.webSocketServerInitialized())
    } catch (error) {
      console.error(messages.webSocketServerInitializationFailed((error as Error).message))
      throw error
    }
  }

  apply(compiler: Compiler) {
    if (!this.manifestPath) return

    // Initialize the WebSocket server once during plugin instantiation
    // This runs outside of webpack hooks to prevent recreation on file changes
    if (!this.isServerInitialized) {
      this.initializeServer(compiler).catch((error) => {
        console.error(
          messages.webSocketServerPluginApplyFailed((error as Error).message)
        )
      })
    }

    // Handle file changes - reuse existing server instead of creating new one
    compiler.hooks.watchRun.tapAsync(
      'reload:handle-file-changes',
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
            messages.fileUpdated(relativePath, context)
          )
        }

        // Use existing server instead of creating a new one
        if (this.webSocketServer && this.manifestPath) {
          messageDispatcher(
            this.webSocketServer,
            this.manifestPath,
            changedFile
          )
        } else {
          console.warn(
            messages.webSocketServerNotReady()
          )
        }

        done()
      }
    )
  }
}
