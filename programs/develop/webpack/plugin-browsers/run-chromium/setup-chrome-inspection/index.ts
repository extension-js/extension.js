import {type Compiler} from '@rspack/core'
import {CDPClient, checkChromeRemoteDebugging} from './cdp-client'
import {type DevOptions} from '../../../../develop-lib/config-types'
import * as messages from '../../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {InstanceManager} from '../../browsers-lib/instance-manager'

export class SetupChromeInspectionStep {
  private devOptions: DevOptions & {startingUrl?: string}
  private cdpClient: CDPClient | null = null
  private currentTargetId: string | null = null
  private currentSessionId: string | null = null
  private isInitialized = false
  private lastSvelteProbe: string | null = null
  private probeTimer: NodeJS.Timeout | null = null

  constructor(devOptions: DevOptions & {startingUrl?: string}) {
    this.devOptions = devOptions
  }

  private async getCdpPort(): Promise<number> {
    const instanceId = (this.devOptions as any).instanceId

    if (instanceId) {
      try {
        const instanceManager = new InstanceManager(process.cwd())
        const instance = await instanceManager.getInstance(instanceId)

        if (instance?.debugPort && Number.isFinite(instance.debugPort)) {
          return instance.debugPort
        }
      } catch {}
    }
    // Fallback to derived port if registry not available
    return deriveDebugPortWithInstance(this.devOptions.port as any, instanceId)
  }

  async initialize(port?: number): Promise<void> {
    try {
      if (!port) port = await this.getCdpPort()
      // Only show waiting messages in development
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorWaitingForChrome())
      }
      let retries = 0
      const maxRetries = 60
      // Ensure we do not spin CPU too fast on repeated polling
      const backoffMs = 500

      while (retries < maxRetries) {
        const isDebuggingEnabled = await checkChromeRemoteDebugging(port)
        if (isDebuggingEnabled) {
          if (process.env.EXTENSION_ENV === 'development') {
            console.log(messages.chromeRemoteDebuggingReady())
          }
          break
        }
        retries++
        if (retries % 10 === 0 && process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.sourceInspectorChromeNotReadyYet(retries, maxRetries)
          )
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }

      if (retries >= maxRetries) {
        throw new Error(messages.sourceInspectorChromeDebuggingRequired(port))
      }

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
      // Only log in development
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorOpeningUrl(url))
        console.log(messages.sourceInspectorFindingExistingTarget())
      }
      const targets = await this.cdpClient.getTargets()
      const existingTarget = targets.find(
        (target) => target.url === url && target.type === 'page'
      )

      if (existingTarget) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.sourceInspectorUsingExistingTarget(existingTarget.targetId)
          )
        }
        this.currentTargetId = existingTarget.targetId
      } else {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.sourceInspectorCreatingTarget())
        }
        this.currentTargetId = await this.cdpClient.createTarget(url)
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.sourceInspectorTargetCreated(this.currentTargetId)
          )
          console.log(messages.sourceInspectorEnsuringNavigation())
        }
        await this.cdpClient.navigateToUrl(this.currentTargetId, url)
      }

      if (!this.currentTargetId) {
        throw new Error('Failed to get or create target')
      }

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorAttachingToTarget())
      }
      this.currentSessionId = await this.cdpClient.attachToTarget(
        this.currentTargetId
      )
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          messages.sourceInspectorAttachedToTarget(this.currentSessionId)
        )
        console.log(messages.sourceInspectorEnablingPageDomain())
      }
      await this.cdpClient.sendCommand('Page.enable', {}, this.currentSessionId)

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorWaitingForPageLoad())
      }
      await this.cdpClient.waitForLoadEvent(this.currentSessionId)

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorWaitingForContentScripts())
      }
      await this.cdpClient.waitForContentScriptInjection(this.currentSessionId)

      // This is the real inspection data step for the user:
      const html = await this.cdpClient.getPageHTML(this.currentSessionId)

      // Svelte-specific: if Shadow DOM isn't printable, assert via probe marker
      try {
        const probe = await this.cdpClient.evaluate(
          this.currentSessionId,
          "(function(){ var p = document.getElementById('extension-probe-svelte'); return p ? String(p.textContent||'') : '' })()"
        )
        if (probe) {
          console.log(`[Extension.js] Svelte probe detected: ${probe}`)
        }
      } catch {}

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.sourceInspectorHTMLExtractionComplete())
      }
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
  async startWatching(websocketServer: any): Promise<void> {
    if (process.env.EXTENSION_ENV !== 'development') return
    if ((this as any).isWatching) {
      console.log(messages.sourceInspectorWatchModeActive())
      return
    }
    ;(this as any).isWatching = true
    console.log(messages.sourceInspectorStartingWatchMode())
    this.setupWebSocketHandler(websocketServer)
    console.log(messages.sourceInspectorCDPConnectionMaintained())
  }

  private setupWebSocketHandler(websocketServer: any): void {
    if (process.env.EXTENSION_ENV !== 'development') return
    if (!websocketServer || !websocketServer.clients) {
      console.warn(messages.sourceInspectorInvalidWebSocketServer())
      return
    }
    websocketServer.clients.forEach((ws: any) => {
      this.setupConnectionHandler(ws)
    })
    websocketServer.on('connection', (ws: any) => {
      this.setupConnectionHandler(ws)
    })
  }

  private setupConnectionHandler(ws: any): void {
    if (process.env.EXTENSION_ENV !== 'development') return
    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data)
        if (message.type === 'changedFile' && (this as any).isWatching) {
          await this.handleFileChange()
        }
      } catch (error) {
        // Ignore parsing errors
      }
    })
  }

  stopWatching(): void {
    if (process.env.EXTENSION_ENV !== 'development') return
    ;(this as any).isWatching = false
    console.log(messages.sourceInspectorWatchModeStopped())
  }

  private async handleFileChange(): Promise<void> {
    if (process.env.EXTENSION_ENV !== 'development') return
    if (!this.cdpClient || !this.currentSessionId) {
      console.warn(messages.sourceInspectorNoActiveSession())
      return
    }
    if ((this as any).debounceTimer) {
      clearTimeout((this as any).debounceTimer)
    }
    ;(this as any).debounceTimer = setTimeout(async () => {
      try {
        console.log(messages.sourceInspectorFileChanged())
        console.log(
          messages.sourceInspectorWaitingForContentScriptReinjection()
        )
        await this.cdpClient!.waitForContentScriptInjection(
          this.currentSessionId!
        )
        console.log(messages.sourceInspectorReExtractingHTML())
        const html = await this.cdpClient!.getPageHTML(this.currentSessionId!)
        // Svelte-specific: check probe marker on update
        try {
          const probe = await this.cdpClient!.evaluate(
            this.currentSessionId!,
            "(function(){ var p = document.getElementById('extension-probe-svelte'); return p ? String(p.textContent||'') : '' })()"
          )
          if (probe) {
            console.log(`[Extension.js] Svelte probe detected: ${probe}`)
          }
        } catch {}
        this.printUpdatedHTML(html)
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
      this.currentSessionId = await this.cdpClient.attachToTarget(
        this.currentTargetId
      )
      console.log(
        messages.sourceInspectorReconnectedToTarget(this.currentSessionId)
      )
    } catch (error) {
      console.error(
        messages.sourceInspectorReconnectionFailed((error as Error).message)
      )
    }
  }

  // For the user: print the HTML inspection result
  printHTML(html: string): void {
    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(html)
    console.log(messages.sourceInspectorHTMLOutputFooter())
  }

  // Only for development: print updated HTML after file change
  printUpdatedHTML(html: string): void {
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

    compiler.hooks.done.tapAsync(
      'plugin-reload:setup-chrome-inspection',
      async (stats, done) => {
        try {
          if (!this.isInitialized) {
            await this.initialize()
          }

          // User: to see the real inspection data, provide --source <url> or --starting-url <url>
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
            webSocketServer &&
            process.env.EXTENSION_ENV === 'development'
          ) {
            this.startWatching(webSocketServer)
          }

          done()
        } catch (error) {
          if (process.env.EXTENSION_ENV === 'development') {
            console.error(
              messages.sourceInspectorSetupFailed((error as Error).message)
            )
          }
          done()
        }
      }
    )
  }
}
