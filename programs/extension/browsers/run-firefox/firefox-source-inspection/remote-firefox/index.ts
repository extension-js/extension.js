// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {appendFileSync, existsSync, mkdirSync} from 'fs'
import path from 'path'
import type {CompilationLike} from '../../../browsers-types'
import {MessagingClient} from './messaging-client'

function emitFirefoxAgentDebugLog(payload: Record<string, unknown>) {
  const line = JSON.stringify({
    sessionId: 'a87efc',
    timestamp: Date.now(),
    ...payload
  })
  fetch('http://127.0.0.1:7795/ingest/9eb8f923-a325-4455-a46c-a6e706558307', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'a87efc'
    },
    body: line
  }).catch(() => {})
  try {
    let dir = path.resolve(process.cwd())
    for (let depth = 0; depth < 24; depth++) {
      if (existsSync(path.join(dir, 'programs', 'develop', 'package.json'))) {
        const filePath = path.join(dir, '.cursor', 'debug-a87efc.log')
        mkdirSync(path.dirname(filePath), {recursive: true})
        appendFileSync(filePath, `${line}\n`)
        return
      }
      const parent = path.dirname(dir)
      if (parent === dir) {
        break
      }
      dir = parent
    }
  } catch {
    // ignore
  }
}
import {isErrorWithCode, requestErrorToMessage} from './message-utils'
import * as messages from '../../../browsers-lib/messages'
import {
  RDP_MAX_RETRIES,
  RDP_RETRY_INTERVAL_MS
} from '../../../browsers-lib/constants'
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
  type ContentScriptTargetRule,
  urlMatchesAnyContentScriptRule
} from '../../../browsers-lib/content-script-targets'
import {
  getInstancePorts,
  getLastRDPPort
} from '../../../browsers-lib/instance-registry'
import {toExtensionLoadList} from '../../../browsers-lib/runtime-options'
import {deriveDebugPortWithInstance} from '../../../browsers-lib/shared-utils'
import {waitForStableExtensionOutput} from '../../../run-chromium/manifest-readiness'

const MAX_RETRIES = RDP_MAX_RETRIES
const RETRY_INTERVAL = RDP_RETRY_INTERVAL_MS

export class RemoteFirefox {
  private readonly options: PluginInterface & {
    browserVersionLine?: string
  }
  private needsReinstall = false
  private client: MessagingClient | null = null
  private loggingAttached = false
  private cachedAddonsActor: string | undefined
  private cachedSupportsReload: boolean | null = null
  private lastInstalledAddonPath: string | undefined
  private derivedExtensionId: string | undefined

  private selectPrimaryAddonPath(
    compilation: CompilationLike,
    candidateAddonPaths: string[]
  ): string | undefined {
    const normalizedOutputPath = String(
      compilation?.options?.output?.path || ''
    ).replace(/\\/g, '/')

    if (normalizedOutputPath) {
      const matchingAddonPath = candidateAddonPaths.find(
        (candidateAddonPath) =>
          String(candidateAddonPath || '').replace(/\\/g, '/') ===
          normalizedOutputPath
      )
      if (matchingAddonPath) return matchingAddonPath
    }

    return candidateAddonPaths[candidateAddonPaths.length - 1]
  }

  constructor(
    configOptions: PluginInterface & {
      browserVersionLine?: string
    }
  ) {
    this.options = configOptions
  }

  private resolveRdpPort(compilation?: CompilationLike): number {
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

  public async installAddons(compilation: CompilationLike) {
    const {devtools} = this.options

    // Ensure user extension is first, manager after (if present)
    const rawExtensions = toExtensionLoadList(this.options.extension)
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
    const primaryAddonPath = this.selectPrimaryAddonPath(
      compilation,
      candidateAddonPaths
    )

    // #region agent log
    try {
      const outPath = String(compilation?.options?.output?.path || '').replace(
        /\\/g,
        '/'
      )
      emitFirefoxAgentDebugLog({
        runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-install',
        hypothesisId: 'H-COMP-3',
        location: 'remote-firefox/index.ts:installAddons:paths',
        message: 'Firefox candidate add-on paths and primary selection',
        data: {
          normalizedOutputPath: outPath,
          primaryAddonPath: primaryAddonPath
            ? String(primaryAddonPath).replace(/\\/g, '/')
            : null,
          candidateAddonPaths: candidateAddonPaths.map((p) =>
            String(p).replace(/\\/g, '/')
          ),
          devtools: Boolean(devtools)
        }
      })
    } catch {
      // ignore
    }
    // #endregion

    for (const addonPath of candidateAddonPaths) {
      try {
        const ready = await waitForStableExtensionOutput(addonPath, {
          timeoutMs: 10000,
          pollIntervalMs: 150,
          stableReadsRequired: 2
        })

        if (!ready && process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.warn(
            `[browser] Firefox add-on output did not fully settle before install: ${addonPath}`
          )
        }
      } catch {
        // best-effort readiness guard
      }
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      try {
        console.log('[browser] Firefox add-on paths:', candidateAddonPaths)
      } catch {
        // ignore
      }
    }

    /** ID of the user extension (webpack output), not companion devtools/theme add-ons. */
    let primaryUserAddonId: string | undefined

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

        const maybeIdRaw = installResponse?.addon?.id
        const maybeId =
          typeof maybeIdRaw === 'string' && maybeIdRaw.length > 0
            ? maybeIdRaw
            : null
        if (
          primaryAddonPath &&
          String(addonPath) === String(primaryAddonPath) &&
          maybeId
        ) {
          primaryUserAddonId = maybeId
        }

        // #region agent log
        emitFirefoxAgentDebugLog({
          runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-install',
          hypothesisId: 'H-COMP-1',
          location: 'remote-firefox/index.ts:installAddons:each',
          message: 'Firefox temporary add-on installed',
          data: {
            index,
            addonPath: String(addonPath).replace(/\\/g, '/'),
            isManager,
            isDevtoolsEnabled,
            addonId: maybeId,
            setDerivedExtensionIdFromThisInstall: Boolean(
              primaryAddonPath &&
                String(addonPath) === String(primaryAddonPath) &&
                maybeId
            ),
            matchesPrimary:
              Boolean(primaryAddonPath) &&
              String(addonPath) === String(primaryAddonPath)
          }
        })
        // #endregion

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

    if (primaryUserAddonId) {
      this.derivedExtensionId = primaryUserAddonId
    }

    // If flagged by reload pipeline, force reinstall of the first (user) add-on
    try {
      if (this.needsReinstall && primaryAddonPath) {
        const toActor = addonsActor

        if (toActor) {
          await client.request({
            to: toActor,
            type: 'installTemporaryAddon',
            addonPath: primaryAddonPath,
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

    // #region agent log
    emitFirefoxAgentDebugLog({
      runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-install',
      hypothesisId: 'H-COMP-2',
      location: 'remote-firefox/index.ts:installAddons:derived-id',
      message:
        'Firefox derivedExtensionId after installs + deriveMozExtensionId',
      data: {
        derivedExtensionId: this.derivedExtensionId || null,
        lastInstalledAddonPath: primaryAddonPath
          ? String(primaryAddonPath).replace(/\\/g, '/')
          : null
      }
    })
    // #endregion

    // Print banner with best-effort extensionId when available
    this.lastInstalledAddonPath = primaryAddonPath

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
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        try {
          console.log(
            messages.firefoxRdpReloadCapabilitySummary(
              this.cachedSupportsReload ? 'native' : 'reinstall'
            )
          )
        } catch {}
      }
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
    compilation: CompilationLike,
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
      const isContentScriptChanged = normalized.some((n) =>
        /(^|\/)content_scripts\/content-\d+(?:\.[a-f0-9]+)?\.(js|css)$/i.test(n)
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
        isManifestChanged ||
        isLocalesChanged ||
        isServiceWorkerChanged ||
        isContentScriptChanged

      if (!critical) return

      await this.reloadAddonOrReinstall(client)
    } catch {
      // Ignore
    }
  }

  public async reloadMatchingTabsForContentScripts(
    rules: ContentScriptTargetRule[]
  ): Promise<number> {
    if (rules.length === 0) return 0

    try {
      const rdpPort = this.resolveRdpPort()
      const client = this.client || (await this.connectClient(rdpPort))
      await this.reloadAddonOrReinstall(client)

      // Brief settle after reinstall so Firefox updates internal tab state.
      await new Promise((resolve) => setTimeout(resolve, 300))

      const tabs = await client.getTargets()
      let reloadedTabs = 0

      for (const tab of tabs || []) {
        const descriptorActor = String((tab as any)?.actor || '')
        const descriptorConsoleActor = String(
          (tab as any)?.consoleActor || (tab as any)?.webConsoleActor || ''
        )
        const url = String((tab as any)?.url || '')

        if (!descriptorActor || !url) continue
        if (!urlMatchesAnyContentScriptRule(url, rules)) continue

        // Resolve the tab descriptor into a frame-level target actor, the
        // same way source-inspection navigation does it. Descriptor-level
        // actors don't support navigateTo on modern Firefox.
        let targetActor = descriptorActor
        let consoleActor = descriptorConsoleActor
        try {
          const detail = await client.getTargetFromDescriptor(descriptorActor)
          if (detail.targetActor) targetActor = detail.targetActor
          if (detail.consoleActor) consoleActor = detail.consoleActor
        } catch {
          // Fall through with descriptor-level actors.
        }

        try {
          try {
            await client.attach(targetActor)
          } catch {
            // Already attached or not required — continue.
          }
          await client.navigate(targetActor, url)
          await client.waitForLoadEvent(targetActor)
          reloadedTabs += 1
        } catch {
          if (!consoleActor) continue
          try {
            await client.navigateViaScript(consoleActor, url)
            reloadedTabs += 1
          } catch {
            // Ignore individual tab failures and continue with the remaining matches.
          }
        }
      }

      return reloadedTabs
    } catch {
      return 0
    }
  }

  // RDP-based source inspection for Firefox
  public async inspectSource(
    compilation: CompilationLike,
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
