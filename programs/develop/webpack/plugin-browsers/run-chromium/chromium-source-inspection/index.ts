import {type Compiler} from '@rspack/core'
import {WebSocketServer} from 'ws'
import * as messages from '../../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {CDPClient} from './cdp-client'
import {waitForChromeRemoteDebugging} from './readiness'
import {ensureTargetAndSession} from './targets'
import {extractPageHtml} from './extract'
import {type DevOptions} from '../../../webpack-types'

/**
 * ChromiumSourceInspectionPlugin
 *
 * Intended responsibilities:
 * - Dev-only page/extension inspection; attach to target and extract HTML
 * - Optional watch mode to re-print HTML on file changes
 */
export class ChromiumSourceInspectionPlugin {
  private devOptions: Pick<DevOptions, 'port' | 'source' | 'watchSource'> & {
    startingUrl?: string
    instanceId?: string
  }
  private cdpClient: CDPClient | null = null
  private currentTargetId: string | null = null
  private currentSessionId: string | null = null
  private isInitialized = false
  private isWatching = false
  private debounceTimer: NodeJS.Timeout | null = null

  constructor(
    devOptions: Pick<DevOptions, 'port' | 'source' | 'watchSource'> & {
      startingUrl?: string
      instanceId?: string
    },
    _ctx?: unknown
  ) {
    this.devOptions = devOptions
  }

  private async getCdpPort(): Promise<number> {
    const instanceId = this.devOptions.instanceId
    return deriveDebugPortWithInstance(this.devOptions.port, instanceId)
  }

  async initialize(port?: number): Promise<void> {
    try {
      if (!port) port = await this.getCdpPort()

      const instanceId = this.devOptions.instanceId
      await waitForChromeRemoteDebugging(port, instanceId)

      this.cdpClient = new CDPClient(port)
      await this.cdpClient.connect()

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorInitialized())
      }

      this.isInitialized = true
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.error(
          messages.sourceInspectorInitializationFailed((error as Error).message)
        )
      }
      throw error
    }
  }

  // The main step for the user: open a URL and get its HTML content
  async inspectSource(url: string): Promise<string> {
    if (!this.cdpClient) {
      throw new Error(messages.sourceInspectorNotInitialized())
    }

    try {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorOpeningUrl(url))
        console.log(messages.sourceInspectorFindingExistingTarget())
      }

      const {targetId, sessionId} = await ensureTargetAndSession(
        this.cdpClient,
        url
      )
      this.currentTargetId = targetId
      this.currentSessionId = sessionId

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorWaitingForPageLoad())
      }

      await this.cdpClient.waitForLoadEvent(this.currentSessionId)

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorWaitingForContentScripts())
      }

      await this.cdpClient.waitForContentScriptInjection(this.currentSessionId)

      // Extra reliable poll: wait until #extension-root with shadowRoot exists (up to ~12s)
      try {
        const deadline = Date.now() + 12000

        while (Date.now() < deadline) {
          const hasRoot = await this.cdpClient.evaluate(
            this.currentSessionId,
            `(() => { try { const h = document.querySelector('#extension-root,[data-extension-root="true"]'); return !!(h && h.shadowRoot) } catch { return false } })()`
          )
          if (hasRoot) break
          await new Promise((r) => setTimeout(r, 300))
        }
      } catch {
        // ignore
      }

      // This is the real inspection data step for the user:
      const html = await extractPageHtml(this.cdpClient, this.currentSessionId)

      return html
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.error(
          messages.sourceInspectorInspectionFailed((error as Error).message)
        )
      }

      throw error
    }
  }

  // Only relevant for development: watch mode and file change handling
  async startWatching(websocketServer: WebSocketServer): Promise<void> {
    if (process.env.EXTENSION_ENV !== 'development') return

    if (this.isWatching) {
      console.log(messages.sourceInspectorWatchModeActive())
      return
    }

    this.isWatching = true
    console.log(messages.sourceInspectorStartingWatchMode())

    this.setupWebSocketHandler(websocketServer)
    console.log(messages.sourceInspectorCDPConnectionMaintained())
  }

  private setupWebSocketHandler(websocketServer: WebSocketServer) {
    if (process.env.EXTENSION_ENV !== 'development') return

    if (!websocketServer || !websocketServer.clients) {
      console.warn(messages.sourceInspectorInvalidWebSocketServer())
      return
    }

    websocketServer.clients.forEach((ws: unknown) => {
      this.setupConnectionHandler(
        ws as {on: (event: 'message', cb: (data: string) => void) => void}
      )
    })

    websocketServer.on('connection', (ws: unknown) => {
      this.setupConnectionHandler(
        ws as {on: (event: 'message', cb: (data: string) => void) => void}
      )
    })
  }

  private setupConnectionHandler(ws: {
    on: (event: 'message', cb: (data: string) => void) => void
  }) {
    if (process.env.EXTENSION_ENV !== 'development') return

    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data)
        if (message.type === 'changedFile' && this.isWatching) {
          await this.handleFileChange()
        }
      } catch (error) {
        // Ignore parsing errors
      }
    })
  }

  stopWatching() {
    if (process.env.EXTENSION_ENV !== 'development') return

    this.isWatching = false
    console.log(messages.sourceInspectorWatchModeStopped())
  }

  private async handleFileChange(): Promise<void> {
    if (process.env.EXTENSION_ENV !== 'development') return

    if (!this.cdpClient || !this.currentSessionId) {
      console.warn(messages.sourceInspectorNoActiveSession())
      return
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        console.log(messages.sourceInspectorFileChanged())
        console.log(
          messages.sourceInspectorWaitingForContentScriptReinjection()
        )

        await this.cdpClient!.waitForContentScriptInjection(
          this.currentSessionId!
        )

        console.log(messages.sourceInspectorReExtractingHTML())
        let html = ''

        try {
          html = await this.cdpClient!.getPageHTML(this.currentSessionId!)
        } catch (e) {
          // Fallback: small delay then try one more time
          // to ensure a print even if timing is tight
          await new Promise((r) => setTimeout(r, 250))
          try {
            html = await this.cdpClient!.getPageHTML(this.currentSessionId!)
          } catch {
            // ignore
          }
        }

        // If still empty, force one more probe read a moment later (JS can be late)
        if (!html) {
          await new Promise((r) => setTimeout(r, 300))
          try {
            html = await this.cdpClient!.getPageHTML(this.currentSessionId!)
          } catch {
            // ignore
          }
        }

        this.printUpdatedHTML(html || '')
      } catch (error) {
        console.error(
          messages.sourceInspectorHTMLUpdateFailed((error as Error).message)
        )

        if (
          (error as Error).message.includes('session') ||
          (error as Error).message.includes('target')
        ) {
          console.log(messages.sourceInspectorAttemptingReconnection())
          await this.reconnectToTarget()
        }
      }
    }, 300)
  }

  private async reconnectToTarget(): Promise<void> {
    if (process.env.EXTENSION_ENV !== 'development') return

    try {
      if (!this.cdpClient || !this.currentTargetId) {
        console.warn(messages.sourceInspectorCannotReconnect())
        return
      }

      console.log(messages.sourceInspectorReconnectingToTarget())
      this.currentSessionId =
        (await this.cdpClient.attachToTarget(this.currentTargetId)) || null
      console.log(
        messages.sourceInspectorReconnectedToTarget(this.currentSessionId || '')
      )
    } catch (error) {
      console.error(
        messages.sourceInspectorReconnectionFailed((error as Error).message)
      )
    }
  }

  // For the user: print the HTML inspection result
  printHTML(html: string) {
    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(html)
    console.log(messages.sourceInspectorHTMLOutputFooter())
  }

  // Only for development: print updated HTML after file change
  printUpdatedHTML(html: string) {
    if (process.env.EXTENSION_ENV !== 'development') return

    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(
      messages.sourceInspectorHTMLOutputTitle(
        'UPDATED - after content script injection'
      )
    )
    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(html)
    console.log(messages.sourceInspectorHTMLOutputFooter())
  }

  async cleanup(): Promise<void> {
    try {
      if (process.env.EXTENSION_ENV === 'development') {
        this.stopWatching()
      }

      if (this.cdpClient && this.currentTargetId) {
        await this.cdpClient.closeTarget(this.currentTargetId)
      }

      if (this.cdpClient) {
        this.cdpClient.disconnect()
      }

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorCleanupComplete())
      }
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.error(
          messages.sourceInspectorCleanupError((error as Error).message)
        )
      }
    }
  }

  // The only thing relevant for the user: how to get the inspection data
  apply(compiler: Compiler) {
    if (!this.devOptions.source && !this.devOptions.watchSource) {
      return
    }

    compiler.hooks.done.tapPromise('setup-chrome-inspection', async (stats) => {
      try {
        if (!this.isInitialized) {
          await this.initialize()
        }

        // User: to see the real inspection data,
        // provide --source <url> or --starting-url <url>
        let urlToInspect: string

        if (
          this.devOptions.source &&
          typeof this.devOptions.source === 'string' &&
          this.devOptions.source !== 'true'
        ) {
          urlToInspect = this.devOptions.source
        } else if (this.devOptions.startingUrl) {
          urlToInspect = this.devOptions.startingUrl
        } else {
          throw new Error(messages.sourceInspectorUrlRequired())
        }

        // This is the main output for the user:
        const html = await this.inspectSource(urlToInspect)
        this.printHTML(html)

        // Watch mode is only for development
        const webSocketServer = (compiler.options as any).webSocketServer

        if (
          this.devOptions.watchSource &&
          process.env.EXTENSION_ENV === 'development'
        ) {
          if (webSocketServer) {
            await this.startWatching(webSocketServer)
          } else {
            // Fallback: trigger re-extraction on each rebuild
            try {
              const updated = await this.cdpClient!.getPageHTML(
                this.currentSessionId!
              )
              this.printUpdatedHTML(updated || '')
            } catch {
              // ignore best-effort fallback
            }
          }
        }
      } catch (error) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.error(
            messages.sourceInspectorSetupFailed((error as Error).message)
          )
        }
      }
    })
  }
}
