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

  private isAuthorMode(): boolean {
    const authorMode =
      String(process.env.EXTENSION_AUTHOR_MODE || '')
        .trim()
        .toLowerCase() === 'true'
    const isDevEnv =
      String(process.env.EXTENSION_AUTHOR_MODE || '')
        .trim()
        .toLowerCase() === 'development'
    return authorMode || isDevEnv
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

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorInitialized())
      }

      this.isInitialized = true
    } catch (error) {
      if (this.isAuthorMode()) {
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
      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorOpeningUrl(url))
        console.log(messages.sourceInspectorFindingExistingTarget())
      }

      const {targetId, sessionId} = await ensureTargetAndSession(
        this.cdpClient,
        url
      )
      this.currentTargetId = targetId
      this.currentSessionId = sessionId

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorWaitingForPageLoad())
      }

      await this.cdpClient.waitForLoadEvent(this.currentSessionId)

      // Fast initial extract for reliability under short auto-exit windows
      // Print immediately for --source users to see something quickly
      try {
        const initialHtml = await extractPageHtml(
          this.cdpClient,
          this.currentSessionId
        )
        this.printHTML(String(initialHtml || ''))
      } catch {
        // best-effort initial print
      }

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorWaitingForContentScripts())
      }

      await this.cdpClient.waitForContentScriptInjection(this.currentSessionId)

      // Extra reliable poll: wait until #extension-root with shadowRoot exists (up to ~12s)
      try {
        const deadline = Date.now() + 20000
        const started = Date.now()

        while (Date.now() < deadline) {
          const hasRoot = await this.cdpClient.evaluate(
            this.currentSessionId,
            `(() => { try {
              const hosts = Array.from(document.querySelectorAll('#extension-root,[data-extension-root="true"]'));
              if (!hosts.length) return false;
              for (const h of hosts) {
                try {
                  const sr = h && h.shadowRoot;
                  if (sr && (String(sr.innerHTML||'').length > 0)) return true;
                } catch { /* ignore */ }
              }
              return false;
            } catch { return false } })()`
          )
          if (hasRoot) break
          const elapsed = Date.now() - started
          const delay = elapsed < 2000 ? 150 : 500
          await new Promise((r) => setTimeout(r, delay))
        }
      } catch {
        // ignore
      }

      // This is the real inspection data step for the user (post-injection):
      const html = await extractPageHtml(this.cdpClient, this.currentSessionId)

      return html
    } catch (error) {
      if (this.isAuthorMode()) {
        console.error(
          messages.sourceInspectorInspectionFailed((error as Error).message)
        )
      }

      throw error
    }
  }

  // Only relevant for development: watch mode and file change handling
  async startWatching(websocketServer: WebSocketServer): Promise<void> {
    if (!this.isAuthorMode()) return

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
    if (!this.isAuthorMode()) return

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
    if (!this.isAuthorMode()) return

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
    if (!this.isAuthorMode()) return

    this.isWatching = false
    console.log(messages.sourceInspectorWatchModeStopped())
  }

  private async handleFileChange(): Promise<void> {
    if (!this.isAuthorMode()) return

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
    if (!this.isAuthorMode()) return

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
    const raw = String(process.env.EXTENSION_SOURCE_RAW || '').trim()
    const maxBytesStr = String(
      process.env.EXTENSION_SOURCE_MAX_BYTES || ''
    ).trim()

    const maxBytes = /^\d+$/.test(maxBytesStr)
      ? Math.max(0, parseInt(maxBytesStr, 10))
      : 262144

    const shouldPrintRaw =
      raw === '1' || raw.toLowerCase() === 'true' || maxBytes === 0

    const out = (() => {
      if (shouldPrintRaw) return html

      try {
        const bytes = Buffer.byteLength(html || '', 'utf8')
        if (bytes <= maxBytes) return html

        // Slice by bytes to avoid cutting multi-byte characters incorrectly
        let acc = 0
        let endIndex = 0
        for (let i = 0; i < html.length; i++) {
          const b = Buffer.byteLength(html[i], 'utf8')
          if (acc + b > maxBytes) break
          acc += b
          endIndex = i + 1
        }
        return html.slice(0, endIndex)
      } catch {
        return html
      }
    })()

    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(out)
    if (
      out.length < html.length &&
      maxBytes > 0 &&
      !(raw === '1' || raw.toLowerCase() === 'true')
    ) {
      console.log(
        messages.sourceInspectorHTMLOutputTitle(
          `TRUNCATED - showing first ${maxBytes} bytes (set EXTENSION_SOURCE_RAW=1 or EXTENSION_SOURCE_MAX_BYTES to adjust)`
        )
      )
    }
    console.log(messages.sourceInspectorHTMLOutputFooter())
  }

  // Only for development: print updated HTML after file change
  printUpdatedHTML(html: string) {
    if (!this.isAuthorMode()) return

    const raw = String(process.env.EXTENSION_SOURCE_RAW || '').trim()
    const maxBytesStr = String(
      process.env.EXTENSION_SOURCE_MAX_BYTES || ''
    ).trim()
    const maxBytes = /^\d+$/.test(maxBytesStr)
      ? Math.max(0, parseInt(maxBytesStr, 10))
      : 262144

    const shouldPrintRaw =
      raw === '1' || raw.toLowerCase() === 'true' || maxBytes === 0

    const out = (() => {
      if (shouldPrintRaw) return html

      try {
        const bytes = Buffer.byteLength(html || '', 'utf8')
        if (bytes <= maxBytes) return html

        let acc = 0
        let endIndex = 0

        for (let i = 0; i < html.length; i++) {
          const b = Buffer.byteLength(html[i], 'utf8')

          if (acc + b > maxBytes) break
          acc += b
          endIndex = i + 1
        }
        return html.slice(0, endIndex)
      } catch {
        return html
      }
    })()

    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(
      messages.sourceInspectorHTMLOutputTitle(
        'UPDATED - after content script injection'
      )
    )
    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(out)
    if (
      out.length < html.length &&
      maxBytes > 0 &&
      !(raw === '1' || raw.toLowerCase() === 'true')
    ) {
      console.log(
        messages.sourceInspectorHTMLOutputTitle(
          `TRUNCATED - showing first ${maxBytes} bytes (set EXTENSION_SOURCE_RAW=1 or EXTENSION_SOURCE_MAX_BYTES to adjust)`
        )
      )
    }

    console.log(messages.sourceInspectorHTMLOutputFooter())
  }

  async cleanup(): Promise<void> {
    try {
      if (this.isAuthorMode()) {
        this.stopWatching()
      }

      if (this.cdpClient && this.currentTargetId) {
        await this.cdpClient.closeTarget(this.currentTargetId)
      }

      if (this.cdpClient) {
        this.cdpClient.disconnect()
      }

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorCleanupComplete())
      }
    } catch (error) {
      if (this.isAuthorMode()) {
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

        if (this.devOptions.watchSource && this.isAuthorMode()) {
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
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.error(
            messages.sourceInspectorSetupFailed((error as Error).message)
          )
        }
      }
    })
  }
}
