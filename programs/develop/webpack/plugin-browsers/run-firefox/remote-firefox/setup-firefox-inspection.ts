import {type Compiler} from '@rspack/core'
import {DevOptions} from '../../../../develop-lib/config-types'
import * as messages from '../../browsers-lib/messages'
import {MessagingClient} from './messaging-client'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'

const MAX_CONNECT_RETRIES = 60
const CONNECT_RETRY_INTERVAL_MS = 500
const PAGE_READY_TIMEOUT_MS = 8000
const TARGET_SCAN_INTERVAL_MS = 250
const CHANGE_DEBOUNCE_MS = 300

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// DEBUG logging removed

interface SetupFirefoxInspectionStepOptions extends DevOptions {
  startingUrl?: string
  instanceId?: string
}

export class SetupFirefoxInspectionStep {
  private readonly devOptions: DevOptions & {
    startingUrl?: string
    instanceId?: string
  }
  private client: MessagingClient | null = null
  private currentConsoleActor: string | null = null
  private currentTabActor: string | null = null
  private isWatching = false
  private debounceTimer: NodeJS.Timeout | null = null
  private initialized = false
  private lastUrlToInspect: string | null = null

  constructor(devOptions: SetupFirefoxInspectionStepOptions) {
    this.devOptions = devOptions
  }

  private getRdpPort() {
    return deriveDebugPortWithInstance(
      this.devOptions.port,
      this.devOptions.instanceId
    )
  }

  private async initialize() {
    if (this.initialized) return

    const client = new MessagingClient()
    const port = this.getRdpPort()

    try {
      console.log(messages.sourceInspectorWaitingForFirefox())
    } catch {}

    let retries = 0

    while (retries < MAX_CONNECT_RETRIES) {
      try {
        await client.connect(port)
        this.client = client
        this.initialized = true
        try {
          console.log(messages.firefoxRemoteDebuggingReady())
          console.log(messages.sourceInspectorInitialized())
        } catch {}
        return
      } catch (err) {
        retries++

        if (retries % 10 === 0) {
          try {
            console.log(
              messages.sourceInspectorFirefoxNotReadyYet(
                retries,
                MAX_CONNECT_RETRIES
              )
            )
          } catch {}
        }
        await wait(CONNECT_RETRY_INTERVAL_MS)
      }
    }
    throw new Error(messages.sourceInspectorFirefoxDebuggingRequired(port))
  }

  private resolveUrlToInspect() {
    if (
      this.devOptions.source &&
      typeof this.devOptions.source === 'string' &&
      this.devOptions.source !== 'true'
    ) {
      return this.devOptions.source
    }

    if (this.devOptions.startingUrl) return this.devOptions.startingUrl

    throw new Error(messages.sourceInspectorUrlRequired())
  }

  private async selectActors(urlToInspect: string) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }

    const deadline = Date.now() + 10000
    let triedAddTab = false

    while (Date.now() < deadline) {
      const allTargets = ((await this.client.getTargets()) as any[]) || []

      // 1) Exact URL match
      for (const target of allTargets) {
        if (
          target &&
          typeof target.url === 'string' &&
          target.url === urlToInspect &&
          target.actor
        ) {
          return {
            tabActor: target.actor,
            consoleActor: target.consoleActor || target.actor
          }
        }
      }

      // 2) Try to open the tab once if no match yet
      if (!triedAddTab && urlToInspect) {
        triedAddTab = true
        try {
          await this.client.addTab(urlToInspect)
          await wait(300)
          continue
        } catch {}
      }

      // 3) Fallback to first valid target with an actor
      for (const target of allTargets) {
        if (target && (target.actor || target.outerWindowID)) {
          return {
            tabActor: target.actor,
            consoleActor: target.consoleActor || target.actor
          }
        }
      }

      await wait(TARGET_SCAN_INTERVAL_MS)
    }

    throw new Error(messages.sourceInspectorNoTabTargetFound())
  }

  private async ensureNavigatedAndLoaded(
    urlToInspect: string,
    tabActor: string
  ) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }

    if (!tabActor) {
      throw new Error(messages.sourceInspectorNoTabActorAvailable())
    }

    // Navigate explicitly; current URL may not be reliable via RDP
    // Resolve real target/console actors and attach to frame first
    let consoleActor = tabActor
    let frameActor = tabActor

    try {
      const detail = await this.client.getTargetFromDescriptor(tabActor)
      if (detail.consoleActor) consoleActor = detail.consoleActor
      if (detail.targetActor) frameActor = detail.targetActor
    } catch {}

    try {
      await this.client.attach(frameActor)
    } catch {}

    try {
      await this.client.navigateViaScript(consoleActor, urlToInspect)
      await this.client.waitForPageReady(
        consoleActor,
        urlToInspect,
        PAGE_READY_TIMEOUT_MS
      )
      return
    } catch {}

    // Fallback to native navigate when available
    try {
      const detail = await this.client.getTargetFromDescriptor(tabActor)
      const targetActor = detail.targetActor || tabActor

      try {
        await this.client.attach(targetActor)
      } catch {}

      await this.client.navigate(targetActor, urlToInspect)
      await this.client.waitForLoadEvent(targetActor)
    } catch {}
  }

  private async ensureUrlAndReady(consoleActor: string, urlToInspect: string) {
    if (!this.client) {
      return
    }

    try {
      const href = await this.client.evaluate(
        consoleActor,
        'String(location.href)'
      )
      if (typeof href !== 'string' || !href.startsWith(urlToInspect)) {
        await this.client.navigateViaScript(consoleActor, urlToInspect)
      }
    } catch {}

    await this.client.waitForPageReady(
      consoleActor,
      urlToInspect,
      PAGE_READY_TIMEOUT_MS
    )
  }

  private async resolveConsoleActor(tabActor: string, urlToInspect: string) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }
    const start = Date.now()

    while (Date.now() - start < PAGE_READY_TIMEOUT_MS) {
      try {
        const targets = (await this.client.getTargets()) as any[]
        const byActor = targets.find((t: any) => t && t.actor === tabActor)
        const byUrl = targets.find((t: any) => t && t.url === urlToInspect)
        const match = byActor || byUrl
        const ca = match?.consoleActor || match?.webConsoleActor
        if (typeof ca === 'string' && ca.length > 0) return ca
        // Try probing the tab actor for more info
        try {
          const detail = await this.client.getTargetFromDescriptor(tabActor)
          const guessed = detail.consoleActor
          if (typeof guessed === 'string' && guessed.length > 0) return guessed
        } catch {}
      } catch {}

      await wait(200)
    }

    // Fallback to tabActor if we couldn't resolve; may fail for evaluate
    return tabActor
  }

  private async printHTML(consoleActor: string) {
    if (!this.client) {
      throw new Error('RDP client not initialized')
    }

    // Retry up to 3 times, re-resolving console actor between attempts
    let lastError: any = null

    for (let attempt = 0; attempt < 3; attempt++) {
      let actorToUse = consoleActor
      try {
        if (this.currentTabActor && this.lastUrlToInspect) {
          const fresh = await this.resolveConsoleActor(
            this.currentTabActor,
            this.lastUrlToInspect
          )
          if (fresh) actorToUse = fresh
        }
      } catch {}

      try {
        const descriptor = this.currentTabActor || actorToUse
        if (this.lastUrlToInspect) {
          await this.ensureUrlAndReady(actorToUse, this.lastUrlToInspect)
        }
        // Print page header (URL and title)
        try {
          const currentUrl = await this.client.evaluate(
            actorToUse,
            'String(location.href)'
          )
          const currentTitle = await this.client.evaluate(
            actorToUse,
            'String(document.title)'
          )
          console.log(messages.sourceInspectorHTMLOutputHeader())
          console.log(
            messages.sourceInspectorHTMLOutputTitle(
              `URL: ${currentUrl} | TITLE: ${currentTitle}`
            )
          )
        } catch {}

        const html =
          (await this.client.getPageHTML(descriptor, actorToUse)) || ''
        // Already printed a header above with title; print content now
        console.log(html)
        console.log(messages.sourceInspectorHTMLOutputFooter())
        return
      } catch (err) {
        lastError = err
      }
      await wait(200)
    }
    throw lastError || new Error(messages.sourceInspectorHtmlExtractFailed())
  }

  private async waitForContentScriptInjection(consoleActor: string) {
    if (!this.client) {
      return
    }

    const deadline = Date.now() + PAGE_READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      try {
        const injected = await this.client.evaluate(
          consoleActor,
          `(() => {
            const root = document.getElementById('extension-root');
            if (!root || !root.shadowRoot) return false;
            const html = root.shadowRoot.innerHTML || '';
            return html.length > 0;
          })()`
        )
        if (injected) return
      } catch {}
      await wait(200)
    }
  }

  private setupWebSocketHandler(websocketServer: any) {
    if (!websocketServer || !websocketServer.clients) return
    websocketServer.clients.forEach((ws: any) => {
      this.attachConnection(ws)
    })
    websocketServer.on('connection', (ws: any) => {
      this.attachConnection(ws)
    })
  }

  private attachConnection(ws: any) {
    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data)
        if (message.type === 'changedFile' && this.isWatching) {
          await this.handleFileChange()
        }
      } catch {}
    })
  }

  private async handleFileChange() {
    if (!this.client || !this.currentConsoleActor) return

    if (this.debounceTimer) clearTimeout(this.debounceTimer)

    this.debounceTimer = setTimeout(async () => {
      try {
        if (this.currentTabActor && this.lastUrlToInspect) {
          const freshConsole = await this.resolveConsoleActor(
            this.currentTabActor,
            this.lastUrlToInspect
          )
          if (freshConsole) this.currentConsoleActor = freshConsole
        }

        if (this.lastUrlToInspect) {
          await this.ensureUrlAndReady(
            this.currentConsoleActor!,
            this.lastUrlToInspect
          )
        }

        await this.waitForContentScriptInjection(this.currentConsoleActor!)
        let lastError: any = null

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const descriptor = this.currentTabActor || this.currentConsoleActor!
            const html = (await this.client!.getPageHTML(
              descriptor,
              this.currentConsoleActor!
            )) as string
            console.log(messages.sourceInspectorHTMLOutputHeader())
            console.log(
              messages.sourceInspectorHTMLOutputTitle(
                'UPDATED - after content script injection'
              )
            )
            console.log(html)
            console.log(messages.sourceInspectorHTMLOutputFooter())
            return
          } catch (err) {
            lastError = err
          }
          await wait(200)
        }
        throw lastError || new Error('Failed to update HTML after retries')
      } catch (err) {
        console.error(
          messages.sourceInspectorHTMLUpdateFailed((err as Error).message)
        )
      }
    }, CHANGE_DEBOUNCE_MS)
  }

  apply(compiler: Compiler) {
    if (!this.devOptions.source && !this.devOptions.watchSource) {
      return
    }

    compiler.hooks.done.tapAsync(
      'plugin-reload:setup-firefox-inspection',
      async (_stats, done) => {
        try {
          if (!this.initialized) {
            await this.initialize()
          }

          const urlToInspect = this.resolveUrlToInspect()
          this.lastUrlToInspect = urlToInspect
          console.log(messages.sourceInspectorWillInspect(urlToInspect))

          const {tabActor, consoleActor} = await this.selectActors(urlToInspect)
          this.currentTabActor = tabActor
          await this.ensureNavigatedAndLoaded(urlToInspect, tabActor)
          const resolvedConsoleActor = await this.resolveConsoleActor(
            tabActor,
            urlToInspect
          )
          this.currentConsoleActor = resolvedConsoleActor || consoleActor

          if (this.currentConsoleActor) {
            await this.waitForContentScriptInjection(this.currentConsoleActor)
            // Pass descriptor and console hints for robust HTML extraction
            await this.printHTML(this.currentConsoleActor)
          }

          const webSocketServer = (compiler.options as any).webSocketServer
          if (
            this.devOptions.watchSource &&
            webSocketServer &&
            !this.isWatching
          ) {
            this.isWatching = true
            this.setupWebSocketHandler(webSocketServer)
          }
        } catch (error) {
          console.error(
            messages.sourceInspectorSetupFailed((error as Error).message)
          )
        }
        done()
      }
    )
  }
}
