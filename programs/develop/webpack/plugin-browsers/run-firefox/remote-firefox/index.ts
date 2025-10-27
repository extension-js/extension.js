import {Compilation} from '@rspack/core'
import {MessagingClient} from './messaging-client'
import {isErrorWithCode, requestErrorToMessage} from './message-utils'
import {type PluginInterface} from '../../browsers-types'
import * as messages from '../../browsers-lib/messages'
import {
  printRunningInDevelopmentSummary,
  printSourceInspection
} from '../firefox-utils'
import {
  getAddonsActorWithRetry,
  computeCandidateAddonPaths,
  waitForManagerWelcome,
  installTemporaryAddon
} from './addons-install'
import {attachConsoleListeners, subscribeUnifiedLogging} from './logging'
import {deriveMozExtensionId} from './moz-id'
import {ensureTabForUrl, navigateTo, getPageHTML} from './source-inspect'

const MAX_RETRIES = 150
const RETRY_INTERVAL = 1000

export class RemoteFirefox {
  private readonly options: PluginInterface & {extensionsToLoad?: string[]}
  private needsReinstall = false
  private client: MessagingClient | null = null
  private loggingAttached = false
  private cachedAddonsActor: string | undefined
  private cachedSupportsReload: boolean | null = null
  private lastInstalledAddonPath: string | undefined
  private derivedExtensionId: string | undefined

  constructor(configOptions: PluginInterface) {
    this.options = configOptions
  }

  private async connectClient(port: number) {
    let lastError

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of Array.from({length: MAX_RETRIES})) {
      try {
        const client = new MessagingClient()
        await client.connect(port)
        this.client = client
        return client
      } catch (error: unknown) {
        if (isErrorWithCode('ECONNREFUSED', error)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL))
          lastError = error
        } else {
          const err = error as Error
          console.error(
            messages.generalBrowserError(
              this.options.browser,
              err.stack || String(error)
            )
          )
          throw err
        }
      }
    }

    console.error(messages.errorConnectingToBrowser(this.options.browser))
    throw lastError
  }

  public async installAddons(compilation: Compilation) {
    const {devtools} = this.options

    // Ensure user extension is first, manager after (if present)
    const rawExtensions =
      (Array.isArray(this.options.extensionsToLoad) &&
      this.options.extensionsToLoad.length
        ? this.options.extensionsToLoad
        : undefined) ||
      (Array.isArray(this.options.extension)
        ? this.options.extension
        : [this.options.extension])
    const unique: string[] = Array.from(
      new Set(
        (rawExtensions as string[]).filter(
          (p): p is string => typeof p === 'string' && p.length > 0
        )
      )
    )

    // If two are present, heuristic: path containing '/extensions/<browser>-manager' is manager
    const userFirst = unique.sort((a: string, b: string): number => {
      const isAManager = /extensions\/[a-z-]+-manager/.test(a)
      const isBManager = /extensions\/[a-z-]+-manager/.test(b)
      if (isAManager && !isBManager) return 1
      if (!isAManager && isBManager) return -1
      return 0
    })
    const extensionsToLoad = userFirst
    const devPort = (
      compilation.options as unknown as {devServer?: {port?: number}}
    )?.devServer?.port as number | undefined
    const optionPort = (this.options as unknown as {port?: number})?.port as
      | number
      | string
      | undefined
    const normalizedOptionPort =
      typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
    // If a port is provided via options, assume it's the actual RDP port
    const port =
      (normalizedOptionPort as number) || (devPort ? devPort + 100 : 9222)
    const client = await this.connectClient(port)
    // Fetch addonsActor with retries via helper
    let addonsActor: string | undefined = await getAddonsActorWithRetry(
      client,
      this.cachedAddonsActor
    )
    if (addonsActor) this.cachedAddonsActor = addonsActor

    const candidateAddonPaths: string[] = computeCandidateAddonPaths(
      compilation,
      extensionsToLoad
    )

    for (const [index, addonPath] of candidateAddonPaths.entries()) {
      const isDevtoolsEnabled = index === 0 && Boolean(devtools)
      try {
        const installResponse = await installTemporaryAddon(
          client,
          String(addonsActor || ''),
          addonPath,
          isDevtoolsEnabled
        )
        if (!this.derivedExtensionId) {
          const maybeId = installResponse?.addon?.id
          if (typeof maybeId === 'string' && maybeId.length > 0) {
            this.derivedExtensionId = maybeId
          }
        }
        if (
          index === 1 ||
          (index === 0 && /extensions\/[a-z-]+-manager/.test(String(addonPath)))
        ) {
          await waitForManagerWelcome(client)
        }
      } catch (err) {
        const message = requestErrorToMessage(err)
        throw new Error(
          messages.addonInstallError(this.options.browser, message)
        )
      }
    }

    // If flagged by reload pipeline, force reinstall of the first (user) add-on
    try {
      if (this.needsReinstall && candidateAddonPaths[0]) {
        const toActor = addonsActor
        if (toActor) {
          await client.request({
            to: toActor,
            type: 'installTemporaryAddon',
            addonPath: candidateAddonPaths[0],
            openDevTools: false
          })
        }
        this.needsReinstall = false
      }
    } catch {}

    // Best-effort: if no explicit id yet, try to infer from any moz-extension URL target
    try {
      if (!this.derivedExtensionId) {
        this.derivedExtensionId = await deriveMozExtensionId(client)
      }
    } catch {}

    // Print banner with best-effort extensionId when available (development only)
    this.lastInstalledAddonPath = candidateAddonPaths[0]

    if (compilation?.options?.mode !== 'production') {
      printRunningInDevelopmentSummary(
        candidateAddonPaths,
        'firefox',
        this.derivedExtensionId
      )
    }
  }

  public markNeedsReinstall() {
    this.needsReinstall = true
  }

  // Capability probing: check if reloadAddon is supported by addonsActor
  private async ensureCapabilities(client: MessagingClient): Promise<void> {
    if (this.cachedSupportsReload !== null) return
    const toActor = this.cachedAddonsActor
    try {
      if (!toActor) return
      const desc = (await client.request({
        to: toActor,
        type: 'requestTypes'
      })) as {
        types?: string[]
      }
      const types = Array.isArray(desc?.types) ? desc.types : []
      this.cachedSupportsReload =
        types.includes('reloadAddon') || types.includes('reloadTemporaryAddon')
      try {
        console.log(
          messages.firefoxRdpReloadCapabilitySummary(
            this.cachedSupportsReload ? 'native' : 'reinstall'
          )
        )
      } catch {}
    } catch {
      this.cachedSupportsReload = false
    }
  }

  private async reloadAddonOrReinstall(client: MessagingClient): Promise<void> {
    const toActor = this.cachedAddonsActor
    if (!toActor || !this.lastInstalledAddonPath) return

    await this.ensureCapabilities(client)
    if (this.cachedSupportsReload) {
      try {
        // Try modern name first, then alias
        try {
          await client.request({to: toActor, type: 'reloadAddon'})
        } catch {
          await client.request({to: toActor, type: 'reloadTemporaryAddon'})
        }
        return
      } catch {
        // fall back to reinstall below
      }
    }

    try {
      await client.request({
        to: toActor,
        type: 'installTemporaryAddon',
        addonPath: this.lastInstalledAddonPath,
        openDevTools: false
      })
    } catch {
      // ignore best-effort
    }
  }

  public async hardReloadIfNeeded(
    compilation: Compilation,
    changedAssets: string[]
  ): Promise<void> {
    try {
      const devPort = (
        compilation.options.devServer as unknown as {port?: number}
      )?.port
      const optionPort = (this.options as unknown as {port?: number})?.port
      const normalizedOptionPort =
        typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
      const rdpPort =
        (normalizedOptionPort as number) || (devPort ? devPort + 100 : 9222)
      const client = this.client || (await this.connectClient(rdpPort))

      const manifestAsset = compilation.getAsset('manifest.json')
      const manifestStr = manifestAsset?.source?.source()?.toString() || ''

      if (!manifestStr) return

      let serviceWorker: string | undefined

      if (manifestStr) {
        const manifest = JSON.parse(manifestStr)
        serviceWorker =
          typeof manifest?.background?.service_worker === 'string'
            ? String(manifest.background.service_worker)
            : undefined
      }

      const normalized = (changedAssets || [])
        .map((n) => String(n || ''))
        .map((n) => n.replace(/\\/g, '/'))

      const isManifestChanged = normalized.includes('manifest.json')
      const isLocalesChanged = normalized.some((n) =>
        /(^|\/)__?locales\/.+\.json$/i.test(n)
      )
      const isServiceWorkerChanged = !!(
        serviceWorker && normalized.includes(serviceWorker.replace(/\\/g, '/'))
      )

      const critical =
        isManifestChanged || isLocalesChanged || isServiceWorkerChanged
      if (!critical) return

      await this.reloadAddonOrReinstall(client)
    } catch {
      // Ignore
    }
  }

  // RDP-based source inspection for Firefox
  public async inspectSource(
    compilation: Compilation,
    opts: {startingUrl?: string; source?: string | boolean}
  ): Promise<void> {
    try {
      const devServerPort = (
        compilation.options.devServer as unknown as {port?: number}
      )?.port
      const optionPort = (this.options as unknown as {port?: number})?.port
      const normalizedOptionPort =
        typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
      const rdpPort =
        (normalizedOptionPort as number) ||
        (devServerPort ? devServerPort + 100 : 9222)

      const client = this.client || (await this.connectClient(rdpPort))

      const urlToInspect =
        typeof opts.source === 'string' && opts.source !== 'true'
          ? opts.source
          : opts.startingUrl

      const tab = await ensureTabForUrl(client, urlToInspect)
      if (!tab) return

      if (urlToInspect) {
        await navigateTo(client, tab.actor, tab.consoleActor, urlToInspect)
      }

      const html =
        (await getPageHTML(client, tab.actor, tab.consoleActor)) || ''
      printSourceInspection(html)
    } catch (error) {
      const err = error as Error
      console.warn(
        messages.firefoxInspectSourceNonFatal(err?.message || String(err))
      )
    }
  }

  // Unified logging via Firefox RDP (parity with Chromium CDP)
  // Emits LogEvent-like lines to stdout according to filters/format
  public async enableUnifiedLogging(opts: {
    level?: string
    contexts?: string[] | undefined
    urlFilter?: string | undefined
    tabFilter?: number | string | undefined
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
  }) {
    try {
      if (this.loggingAttached) return

      const devPort = (this.options as unknown as {port?: number})?.port
      const normalized =
        typeof devPort === 'string' ? parseInt(devPort, 10) : devPort
      const rdpPort = (normalized as number) || 9222
      const client = this.client || (await this.connectClient(rdpPort))

      // Proactively attach console listeners to all known targets
      await attachConsoleListeners(client)

      // Prepare logging options (mirrors previous inline variables)
      const levelMap = ['trace', 'debug', 'log', 'info', 'warn', 'error']
      const wantLevel = String(opts.level || 'info').toLowerCase()
      const wantContexts = Array.isArray(opts.contexts)
        ? opts.contexts.map((s) => String(s))
        : undefined
      const urlFilter = String(opts.urlFilter || '')
      const tabFilter =
        typeof opts.tabFilter === 'number' || typeof opts.tabFilter === 'string'
          ? String(opts.tabFilter)
          : ''
      const fmt = (opts.format as 'pretty' | 'json' | 'ndjson') || 'pretty'
      const showTs = opts.timestamps !== false
      const color = !!opts.color

      subscribeUnifiedLogging(client, {
        level: wantLevel,
        contexts: wantContexts,
        urlFilter,
        tabFilter,
        format: fmt,
        timestamps: showTs,
        color
      })

      this.loggingAttached = true
    } catch {
      // Ignore
    }
  }
}
