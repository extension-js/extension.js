// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compilation} from '@rspack/core'
import {MessagingClient} from './messaging-client'
import {isErrorWithCode, requestErrorToMessage} from './message-utils'
import * as messages from '../../../browsers-lib/messages'
import {
  printRunningInDevelopmentSummary,
  printSourceInspection
} from './firefox-utils'
import {
  getAddonsActorWithRetry,
  computeCandidateAddonPaths,
  waitForManagerWelcome,
  installTemporaryAddon
} from './addons-install'
import {deriveMozExtensionId} from './moz-id'
import {attachConsoleListeners, subscribeUnifiedLogging} from './logging'
import {ensureTabForUrl, navigateTo, getPageHTML} from './source-inspect'
import {type PluginInterface} from '../../../browsers-types'
import {
  getInstancePorts,
  getLastRDPPort
} from '../../../browsers-lib/instance-registry'
import {deriveDebugPortWithInstance} from '../../../browsers-lib/shared-utils'

const MAX_RETRIES = 150
const RETRY_INTERVAL = 1000

export class RemoteFirefox {
  private readonly options: PluginInterface & {
    extensionsToLoad?: string[]
    browserVersionLine?: string
  }
  private needsReinstall = false
  private client: MessagingClient | null = null
  private loggingAttached = false
  private cachedAddonsActor: string | undefined
  private cachedSupportsReload: boolean | null = null
  private lastInstalledAddonPath: string | undefined
  private derivedExtensionId: string | undefined

  constructor(
    configOptions: PluginInterface & {
      extensionsToLoad?: string[]
      browserVersionLine?: string
    }
  ) {
    this.options = configOptions
  }

  private resolveRdpPort(compilation?: Compilation): number {
    const instanceId = (this.options as unknown as {instanceId?: string})
      ?.instanceId
    const devPort = (
      compilation?.options as unknown as {devServer?: {port?: number}}
    )?.devServer?.port as number | undefined
    const optionPort = (this.options as unknown as {port?: number})?.port as
      | number
      | string
      | undefined
    const normalizedOptionPort =
      typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
    const basePort = (normalizedOptionPort as number) || devPort
    const desired = deriveDebugPortWithInstance(basePort, instanceId)
    const fromInstance = instanceId
      ? getInstancePorts(instanceId)?.rdpPort
      : undefined

    return fromInstance || getLastRDPPort() || desired
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
    const port = this.resolveRdpPort(compilation)
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
      const isManager = /extensions\/[a-z-]+-manager/.test(String(addonPath))
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

        if (isManager) {
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

    // Print banner with best-effort extensionId when available
    this.lastInstalledAddonPath = candidateAddonPaths[0]

    const bannerPrinted = await printRunningInDevelopmentSummary(
      candidateAddonPaths,
      'firefox',
      this.derivedExtensionId,
      this.options.browserVersionLine
    )
    if (!bannerPrinted) {
      throw new Error(
        messages.addonInstallError(
          this.options.browser,
          'Failed to print runningInDevelopment banner; add-on may not be installed.'
        )
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
      const rdpPort = this.resolveRdpPort(compilation)
      const client = this.client || (await this.connectClient(rdpPort))

      const normalized = (changedAssets || [])
        .map((n) => String(n || ''))
        .map((n) => n.replace(/\\/g, '/'))

      const isManifestChanged = normalized.includes('manifest.json')
      const isLocalesChanged = normalized.some((n) =>
        /(^|\/)__?locales\/.+\.json$/i.test(n)
      )

      // Consider service worker changes as critical as well
      let isServiceWorkerChanged = false
      try {
        const manifestAsset = compilation.getAsset?.('manifest.json')
        const manifestDataSource = manifestAsset?.source?.source
          ? String(manifestAsset.source.source())
          : manifestAsset?.source
            ? String(manifestAsset?.source?.toString())
            : ''

        if (manifestDataSource) {
          const parsed = JSON.parse(manifestDataSource)
          const sw: unknown = parsed?.background?.service_worker

          if (typeof sw === 'string' && sw) {
            const swUnix = (sw as string).replace(/\\/g, '/')
            isServiceWorkerChanged = normalized.includes(swUnix)
          }
        }
      } catch {
        // ignore
      }

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
      const rdpPort = this.resolveRdpPort(compilation)
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

      const rdpPort = this.resolveRdpPort()
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
