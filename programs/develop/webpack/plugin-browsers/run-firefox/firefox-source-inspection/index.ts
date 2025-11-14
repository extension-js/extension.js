import type {Compiler} from '@rspack/core'
import type {FirefoxContext} from '../firefox-context'
import * as messages from '../../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {MessagingClient} from './remote-firefox/messaging-client'
import {selectActors} from './remote-firefox/setup-firefox-inspection-actors'
import {ensureNavigatedAndLoaded} from './remote-firefox/setup-firefox-inspection-navigation'
import {
  resolveConsoleActorMethod,
  waitForContentScriptInjectionMethod,
  getPageHTML
} from './remote-firefox/source-inspect'
import type {DevOptions} from '../../../webpack-types'

const MAX_CONNECT_RETRIES = 60
const CONNECT_RETRY_INTERVAL_MS = 500
const PAGE_READY_TIMEOUT_MS = 8000
const CHANGE_DEBOUNCE_MS = 300

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class FirefoxSourceInspectionPlugin {
  private readonly host: any
  private readonly _ctx?: FirefoxContext

  private devOptions?: DevOptions & {
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

  constructor(host: any, ctx?: FirefoxContext) {
    this.host = host
    this._ctx = ctx
  }

  private setDevOptions() {
    if (!this.devOptions) {
      this.devOptions = {
        browser: this.host.browser,
        mode: this.host.mode || 'development',
        source: this.host.source as string,
        watchSource: this.host.watchSource,
        startingUrl: this.host.startingUrl,
        port: this.host.port,
        instanceId: this.host.instanceId
      }
    }
  }

  private async getRdpPort() {
    const instanceId = this.devOptions?.instanceId
    return deriveDebugPortWithInstance(this.devOptions?.port, instanceId)
  }

  private async initialize() {
    if (this.initialized) return

    const client = new MessagingClient()
    const port = await this.getRdpPort()

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.sourceInspectorWaitingForFirefox())
    }

    let retries = 0

    while (retries < MAX_CONNECT_RETRIES) {
      try {
        await client.connect(port)
        this.client = client
        this.initialized = true
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.firefoxRemoteDebuggingReady())
          console.log(messages.sourceInspectorInitialized())
        }
        return
      } catch (err) {
        retries++

        if (retries % 10 === 0) {
          if (process.env.EXTENSION_ENV === 'development') {
            console.log(
              messages.sourceInspectorFirefoxNotReadyYet(
                retries,
                MAX_CONNECT_RETRIES
              )
            )
          }
        }
        await wait(CONNECT_RETRY_INTERVAL_MS)
      }
    }

    throw new Error(messages.sourceInspectorFirefoxDebuggingRequired(port))
  }

  private resolveUrlToInspect() {
    if (
      this.devOptions?.source &&
      typeof this.devOptions.source === 'string' &&
      this.devOptions.source !== 'true'
    ) {
      return this.devOptions.source
    }

    if (this.devOptions?.startingUrl) return this.devOptions.startingUrl

    throw new Error(messages.sourceInspectorUrlRequired())
  }

  private async selectActors(urlToInspect: string) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }

    return selectActors(this.client, urlToInspect)
  }

  private async ensureNavigatedAndLoaded(
    urlToInspect: string,
    tabActor: string
  ) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }

    return ensureNavigatedAndLoaded(this.client, urlToInspect, tabActor)
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
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        const err = error as Error
        console.warn(
          '[RDP] ensureUrlAndReady evaluate/navigateViaScript failed:',
          String(err.message || err)
        )
      }
    }

    await this.client.waitForPageReady(
      consoleActor,
      urlToInspect,
      PAGE_READY_TIMEOUT_MS
    )
  }

  private async resolveConsoleActor(tabActor: string, urlToInspect: string) {
    if (!this.client)
      throw new Error(messages.sourceInspectorClientNotInitialized())
    return await resolveConsoleActorMethod(this.client, tabActor, urlToInspect)
  }

  private async printHTML(consoleActor: string) {
    if (!this.client) {
      throw new Error('RDP client not initialized')
    }

    // Retry up to 3 times, re-resolving console actor between attempts
    let lastError = null

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
      } catch (error) {
        // Ignore
      }

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
        } catch {
          // Ignore
        }

        const html =
          (await getPageHTML(this.client, descriptor, actorToUse)) || ''
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
    if (!this.client) return
    await waitForContentScriptInjectionMethod(this.client, consoleActor)
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
        let lastError: unknown = null

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const descriptor = this.currentTabActor || this.currentConsoleActor!
            const html = (await getPageHTML(
              this.client!,
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
    if (this.host.dryRun) return
    if (compiler.options.mode !== 'development') return

    this.setDevOptions()

    if (!this.devOptions?.source && !this.devOptions?.watchSource) {
      return
    }

    compiler.hooks.done.tapAsync(
      'setup-firefox-inspection',
      async (_stats, done) => {
        try {
          if (!this.initialized) {
            await this.initialize()
          }

          const urlToInspect = this.resolveUrlToInspect()
          this.lastUrlToInspect = urlToInspect

          if (process.env.EXTENSION_ENV === 'development') {
            console.log(messages.sourceInspectorWillInspect(urlToInspect))
          }

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

          if (this.devOptions?.watchSource) {
            // On each rebuild, re-print current HTML immediately (debounced by handleFileChange)
            this.isWatching = true
            await this.handleFileChange()
          }
        } catch (error) {
          if (process.env.EXTENSION_ENV === 'development') {
            console.error(
              messages.sourceInspectorSetupFailed((error as Error).message)
            )
          }
        }
        done()
      }
    )
  }
}
