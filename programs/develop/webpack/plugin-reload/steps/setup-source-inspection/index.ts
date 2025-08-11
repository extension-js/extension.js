import {type Compiler, type Compilation} from '@rspack/core'
import {
  CDPClient,
  checkChromeRemoteDebugging
} from '../../reload-lib/cdp-client'
import {type DevOptions} from '../../../../commands/commands-lib/config-types'
import * as messages from '../../reload-lib/messages'

export class SetupSourceInspectionStep {
  private devOptions: DevOptions & {startingUrl?: string}
  private cdpClient: CDPClient | null = null
  private currentTargetId: string | null = null
  private currentSessionId: string | null = null
  private isWatching = false
  private debounceTimer: NodeJS.Timeout | null = null
  private isInitialized = false

  constructor(devOptions: DevOptions & {startingUrl?: string}) {
    this.devOptions = devOptions
  }

  // Initialize the source inspector with CDP connection
  async initialize(port: number = 9222): Promise<void> {
    try {
      // Wait for Chrome to be ready with remote debugging
      console.log(messages.sourceInspectorWaitingForChrome())
      let retries = 0
      const maxRetries = 60 // Wait up to 60 seconds for browser to start

      while (retries < maxRetries) {
        const isDebuggingEnabled = await checkChromeRemoteDebugging(port)
        if (isDebuggingEnabled) {
          console.log(messages.chromeRemoteDebuggingReady())
          break
        }

        retries++
        if (retries % 10 === 0) {
          // Log every 10th retry to avoid spam
          console.log(
            messages.sourceInspectorChromeNotReadyYet(retries, maxRetries)
          )
        }
        // Use shorter polling interval for faster response
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      if (retries >= maxRetries) {
        throw new Error(messages.sourceInspectorChromeDebuggingRequired(port))
      }

      // Connect to CDP
      this.cdpClient = new CDPClient(port)
      await this.cdpClient.connect()

      console.log(messages.sourceInspectorInitialized())
      this.isInitialized = true
    } catch (error) {
      console.error(
        messages.sourceInspectorInitializationFailed((error as Error).message)
      )
      throw error
    }
  }

  // Open a URL and get its HTML content
  async inspectSource(url: string): Promise<string> {
    if (!this.cdpClient) {
      throw new Error(messages.sourceInspectorNotInitialized())
    }

    try {
      console.log(messages.sourceInspectorOpeningUrl(url))

      // First, try to find an existing target with the URL
      console.log(messages.sourceInspectorFindingExistingTarget())
      const targets = await this.cdpClient.getTargets()

      // Look for a target that matches our URL
      const existingTarget = targets.find(
        (target) => target.url === url && target.type === 'page'
      )

      if (existingTarget) {
        // Use existing target
        console.log(
          messages.sourceInspectorUsingExistingTarget(existingTarget.targetId)
        )
        this.currentTargetId = existingTarget.targetId
      } else {
        // Create a new target only if none exists
        console.log(messages.sourceInspectorCreatingTarget())
        this.currentTargetId = await this.cdpClient.createTarget(url)
        console.log(messages.sourceInspectorTargetCreated(this.currentTargetId))

        // Ensure the target actually navigates to the URL
        console.log(messages.sourceInspectorEnsuringNavigation())
        await this.cdpClient.navigateToUrl(this.currentTargetId, url)
      }

      // Ensure we have a valid target ID
      if (!this.currentTargetId) {
        throw new Error('Failed to get or create target')
      }

      // Attach to the target to get a session
      console.log(messages.sourceInspectorAttachingToTarget())
      this.currentSessionId = await this.cdpClient.attachToTarget(
        this.currentTargetId
      )
      console.log(
        messages.sourceInspectorAttachedToTarget(this.currentSessionId)
      )

      // Enable page domain to receive load events
      console.log(messages.sourceInspectorEnablingPageDomain())
      await this.cdpClient.sendCommand('Page.enable', {}, this.currentSessionId)

      // Wait for the page to load
      console.log(messages.sourceInspectorWaitingForPageLoad())
      await this.cdpClient.waitForLoadEvent(this.currentSessionId)

      // Wait for content scripts to inject using the working method
      console.log(messages.sourceInspectorWaitingForContentScripts())
      await this.cdpClient.waitForContentScriptInjection(this.currentSessionId)

      // Get the page HTML
      console.log(messages.sourceInspectorExtractingHTML())
      const html = await this.cdpClient.getPageHTML(this.currentSessionId)

      console.log(messages.sourceInspectorHTMLExtractionComplete())
      return html
    } catch (error) {
      console.error(
        messages.sourceInspectorInspectionFailed((error as Error).message)
      )
      throw error
    }
  }

  async startWatching(websocketServer: any): Promise<void> {
    if (this.isWatching) {
      console.log(messages.sourceInspectorWatchModeActive())
      return
    }

    this.isWatching = true
    console.log(messages.sourceInspectorStartingWatchMode())

    // Set up WebSocket handler for file change notifications
    this.setupWebSocketHandler(websocketServer)

    // Keep the CDP connection alive for continuous monitoring
    console.log(messages.sourceInspectorCDPConnectionMaintained())
  }

  private setupWebSocketHandler(websocketServer: any): void {
    if (!websocketServer || !websocketServer.clients) {
      console.warn(messages.sourceInspectorInvalidWebSocketServer())
      return
    }

    // Set up handlers for existing connections
    websocketServer.clients.forEach((ws: any) => {
      this.setupConnectionHandler(ws)
    })

    // Set up handler for new connections
    websocketServer.on('connection', (ws: any) => {
      this.setupConnectionHandler(ws)
    })
  }

  private setupConnectionHandler(ws: any): void {
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

  stopWatching(): void {
    this.isWatching = false
    console.log(messages.sourceInspectorWatchModeStopped())
  }

  private async handleFileChange(): Promise<void> {
    if (!this.cdpClient || !this.currentSessionId) {
      console.warn(messages.sourceInspectorNoActiveSession())
      return
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Use reasonable debounce time for file changes
    this.debounceTimer = setTimeout(async () => {
      try {
        console.log(messages.sourceInspectorFileChanged())

        // Wait for content scripts to reinject using the working method
        console.log(
          messages.sourceInspectorWaitingForContentScriptReinjection()
        )
        await this.cdpClient!.waitForContentScriptInjection(
          this.currentSessionId!
        )

        // Re-extract the page HTML after the file change
        console.log(messages.sourceInspectorReExtractingHTML())
        const html = await this.cdpClient!.getPageHTML(this.currentSessionId!)

        this.printUpdatedHTML(html)
      } catch (error) {
        console.error(
          messages.sourceInspectorHTMLUpdateFailed((error as Error).message)
        )

        // If the session is lost, try to re-establish it
        if (
          (error as Error).message.includes('session') ||
          (error as Error).message.includes('target')
        ) {
          console.log(messages.sourceInspectorAttemptingReconnection())
          await this.reconnectToTarget()
        }
      }
    }, 300) // Reasonable debounce time
  }

  private async reconnectToTarget(): Promise<void> {
    try {
      if (!this.cdpClient || !this.currentTargetId) {
        console.warn(messages.sourceInspectorCannotReconnect())
        return
      }

      console.log(messages.sourceInspectorReconnectingToTarget())

      // Re-attach to the existing target
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

  printHTML(html: string): void {
    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(messages.sourceInspectorHTMLOutputHeader())
    console.log(html)
    console.log(messages.sourceInspectorHTMLOutputFooter())
  }

  printUpdatedHTML(html: string): void {
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
      this.stopWatching()

      if (this.cdpClient && this.currentTargetId) {
        await this.cdpClient.closeTarget(this.currentTargetId)
      }

      if (this.cdpClient) {
        this.cdpClient.disconnect()
      }

      console.log(messages.sourceInspectorCleanupComplete())
    } catch (error) {
      console.error(
        messages.sourceInspectorCleanupError((error as Error).message)
      )
    }
  }

  apply(compiler: Compiler) {
    if (!this.devOptions.source && !this.devOptions.watchSource) {
      return
    }

    compiler.hooks.done.tapAsync(
      'plugin-reload:setup-source-inspection',
      async (stats, done) => {
        try {
          // Wait for browser to be ready - use reasonable delay
          if (!this.isInitialized) {
            await this.initialize()
          }

          // Determine the URL to inspect:
          // 1. Use --source URL if specified (takes precedence over --starting-url)
          // 2. If no --source URL, use --starting-url
          // 3. If neither is present, break with error
          let urlToInspect: string

          if (
            this.devOptions.source &&
            typeof this.devOptions.source === 'string' &&
            this.devOptions.source !== 'true'
          ) {
            // --source with URL takes precedence
            urlToInspect = this.devOptions.source
          } else if (this.devOptions.startingUrl) {
            // Use --starting-url if no --source URL
            urlToInspect = this.devOptions.startingUrl
          } else {
            // Neither --source URL nor --starting-url provided
            throw new Error(messages.sourceInspectorUrlRequired())
          }

          console.log(messages.sourceInspectorWillInspect(urlToInspect))

          const html = await this.inspectSource(urlToInspect)
          this.printHTML(html)

          // Get the WebSocket server from compiler options
          const webSocketServer = (compiler.options as any).webSocketServer
          if (this.devOptions.watchSource && webSocketServer) {
            this.startWatching(webSocketServer)
          }

          done()
        } catch (error) {
          console.error(
            messages.sourceInspectorSetupFailed((error as Error).message)
          )
          done()
        }
      }
    )
  }
}
