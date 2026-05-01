// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {CompilationLike} from '../../../browsers-types'
import {MessagingClient} from './messaging-client'
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
  reinjectMatchingTabsViaAddonRuntime,
  type AddonRuntimeTarget,
  type ReinjectionReport
} from './runtime-reinject'
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
  private lastRuntimeReinjectionReport: ReinjectionReport | null = null

  // Phase F2 — future-navigation parity (mirrors Chromium's
  // registerContentScriptsForFutureNavigations). Tracks the latest rules and
  // a single subscription to tabNavigated/tabListChanged on the RDP transport,
  // so that fresh tabs and same-tab navigations between rebuilds get the
  // current bundle without waiting for the next file edit.
  private activeContentScriptRules: ContentScriptTargetRule[] = []
  private contentScriptListenerInstalled = false
  private futureNavReinjectScheduled = false

  // Phase F3 — capability cache. Probed once per session against the addon
  // background to short-circuit runtime reinjection when browser.scripting
  // isn't reachable (older Firefox or sleeping event-page).
  private cachedRuntimeCapability: {
    hasScripting: boolean
    probedAt: number
  } | null = null

  private runtimePathPermanentlyUnavailable = false

  public getLastRuntimeReinjectionReport(): ReinjectionReport | null {
    return this.lastRuntimeReinjectionReport
  }

  public getRuntimeCapability(): {
    hasScripting: boolean
    probedAt: number
  } | null {
    return this.cachedRuntimeCapability
  }

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

      const isManifestChanged = normalized.some(
        (n) => n === 'manifest.json' || n.endsWith('/manifest.json')
      )
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
            isServiceWorkerChanged = normalized.some(
              (n) => n === swUnix || n.endsWith('/' + swUnix)
            )
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

      // Mirror Chromium's reinjectMatchingTabsViaExtensionRuntime: try to
      // re-execute the latest content-script bundle from the addon's own
      // background context first. This preserves background/popup/sidebar
      // state — the legacy reinstall+navigate path tears it all down on
      // every content-script edit.
      const runtimeAttempt = await this.tryRuntimeReinjection(client, rules)

      if (runtimeAttempt.reinjectedTabs > 0) {
        return runtimeAttempt.reinjectedTabs
      }

      // Fallback: full addon reload + per-tab navigate. Same behavior as
      // before this change. Required when the addon background isn't
      // reachable (event-page asleep, listAddons missing, scripting API
      // unavailable on older Firefox), or when zero tabs were touched
      // because the runtime path matched nothing
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

  private async tryRuntimeReinjection(
    _persistentClient: MessagingClient,
    rules: ContentScriptTargetRule[]
  ): Promise<{reinjectedTabs: number}> {
    const addonsActor = this.cachedAddonsActor
    const addonId = this.derivedExtensionId
    const outPath = this.lastInstalledAddonPath

    if (!addonsActor || !addonId || !outPath) {
      this.lastRuntimeReinjectionReport = {
        phase: 'skipped',
        reason: 'missing_actor_or_addon_id_or_path',
        addonId
      }
      return {reinjectedTabs: 0}
    }

    if (this.runtimePathPermanentlyUnavailable) {
      this.lastRuntimeReinjectionReport = {
        phase: 'skipped',
        reason: 'runtime_path_marked_unavailable',
        addonId
      }
      return {reinjectedTabs: 0}
    }

    // Firefox WatcherActor.target-available-form events fire only when a
    // target first becomes available on a connection. After the initial
    // capture the same connection's watcher will not re-emit, so caching
    // the resolved actors and retrying breaks down when the addon's MV3
    // event-page background restarts mid-session — the cached consoleActor
    // becomes "No such actor" and re-discovery returns nothing. Open a
    // fresh RDP socket per reinject; each connection's watcher is a fresh
    // subscription that emits the *current* addon background target.
    let scopedClient: MessagingClient | null = null
    try {
      scopedClient = new MessagingClient()
      await scopedClient.connect(this.resolveRdpPort())
      // Firefox writes the root-actor welcome packet ({from:'root', ...})
      // immediately after a client connects. The transport routes
      // packets by `from` to the matching pending request, so if our
      // first request (listTabs to root) reaches the wire before the
      // welcome lands in our read buffer, the welcome ends up resolving
      // the listTabs deferred — and listTabs sees `{tabs: undefined}`,
      // producing a phantom no_payload skip per reinject. Wait briefly
      // for the welcome to flow through transport.handleMessage with no
      // active deferred (it falls through to a 'message' emit we don't
      // listen to) before we send the first request.
      await new Promise((resolve) => setTimeout(resolve, 50))
      const {reinjectedTabs, report} =
        await reinjectMatchingTabsViaAddonRuntime(scopedClient, {
          outPath,
          rules,
          addonsActor,
          addonId,
          matchUrl: (url, rule) => urlMatchesAnyContentScriptRule(url, [rule])
        })
      this.lastRuntimeReinjectionReport = report
      if (
        report.phase === 'evaluated' &&
        typeof report.hasScripting === 'boolean'
      ) {
        this.cachedRuntimeCapability = {
          hasScripting: report.hasScripting,
          probedAt: Date.now()
        }
      }
      // Mark the runtime path as permanently unavailable on signals that
      // imply Firefox can't expose the addon background to us via RDP at
      // all (no descriptor matched, getWatcher hangs, scripting API not
      // reachable). Subsequent reinjects skip F1 and go straight to the
      // legacy reinstall+navigate fallback — preventing the cascade where
      // each fallback's tabListChanged retriggers F1, hangs, and reloads
      // again indefinitely.
      if (report.phase === 'unavailable') {
        const reason = String(report.reason || '')
        if (
          reason === 'no_runtime_target' ||
          reason === 'no_runtime_target_after_stale' ||
          reason === 'no_browser_scripting_in_runtime' ||
          /timeout/i.test(reason)
        ) {
          this.runtimePathPermanentlyUnavailable = true
        }
      }
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        try {
          console.log(
            messages.firefoxRdpRuntimeReinjectionResult(JSON.stringify(report))
          )
        } catch {
          // Do nothing
        }
      }
      return {reinjectedTabs}
    } catch (error) {
      this.lastRuntimeReinjectionReport = {
        phase: 'unavailable',
        reason: `unhandled: ${String((error as Error)?.message || error)}`,
        addonId
      }
      return {reinjectedTabs: 0}
    } finally {
      try {
        scopedClient?.disconnect()
      } catch {
        // best-effort socket teardown
      }
    }
  }

  public async registerContentScriptsForFutureNavigations(
    rules: ContentScriptTargetRule[]
  ): Promise<void> {
    this.activeContentScriptRules = [...rules]
    if (rules.length === 0) return

    let client: MessagingClient | null = this.client
    if (!client) {
      try {
        const port = this.resolveRdpPort()
        client = await this.connectClient(port)
      } catch {
        return
      }
    }

    if (this.contentScriptListenerInstalled) return
    this.contentScriptListenerInstalled = true
    this.installContentScriptTabListener(client)
  }

  private installContentScriptTabListener(client: MessagingClient): void {
    client.on('message', (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return

      const message = raw as {
        type?: string
        from?: string
        url?: string
        state?: string
      }
      if (
        process.env.EXTENSION_AUTHOR_MODE === 'true' &&
        process.env.EXTJS_F2_TRACE === '1' &&
        (message.type || message.from)
      ) {
        try {
          // eslint-disable-next-line no-console
          console.log(
            `[f2-trace] type=${message.type} from=${message.from} state=${message.state} url=${(message.url || '').slice(0, 80)}`
          )
        } catch {}
      }
      // Two complementary signals on the connection:
      //   tabListChanged — root-actor broadcast when any tab opens/closes,
      //                    fired on every connection regardless of attach
      //   tabNavigated  — per-tab actor emits state=stop on attached tabs
      // tabListChanged catches fresh tabs the dev connection hasn't
      // attached to yet; tabNavigated catches navigations on already-known
      // tabs. The runtime reinject inside scheduleFutureNavReinject queries
      // browser.tabs.query, so it doesn't matter which tab triggered the
      // event — the addon picks up every matching tab on the next pass.
      if (message.type === 'tabListChanged' && message.from === 'root') {
        this.scheduleFutureNavReinject()
        return
      }
      if (message.type !== 'tabNavigated') return
      if (message.state !== 'stop') return

      const url = String(message.url || '')

      if (!url) return
      if (!this.urlMatchesAnyActiveRule(url)) return

      this.scheduleFutureNavReinject()
    })
  }

  private urlMatchesAnyActiveRule(url: string): boolean {
    if (!url || this.activeContentScriptRules.length === 0) return false

    return this.activeContentScriptRules.some((rule) =>
      urlMatchesAnyContentScriptRule(url, [rule])
    )
  }

  private scheduleFutureNavReinject(): void {
    if (this.futureNavReinjectScheduled) return
    this.futureNavReinjectScheduled = true

    // Coalesce bursts of tabNavigated events (multi-frame loads, redirect
    // chains) into a single runtime reinject pass. The runtime path is
    // idempotent — re-running on tabs that already received the latest
    // generation is a no-op via __EXTENSIONJS_DEV_REINJECT__.
    setTimeout(() => {
      this.futureNavReinjectScheduled = false
      const rules = this.activeContentScriptRules
      const client = this.client

      if (!client || rules.length === 0) return
      this.tryRuntimeReinjection(client, rules).catch(() => {
        // Best-effort; the next rebuild will retry.
      })
    }, 100)
  }

  public async probeRuntimeCapability(
    client?: MessagingClient
  ): Promise<{hasScripting: boolean} | null> {
    if (this.cachedRuntimeCapability) return this.cachedRuntimeCapability

    const addonsActor = this.cachedAddonsActor
    const addonId = this.derivedExtensionId

    if (!addonsActor || !addonId) return null

    const target = client || this.client
    if (!target) return null

    const {attachToAddonBackgroundConsole} = await import('./runtime-reinject')
    const console_ = await attachToAddonBackgroundConsole(
      target,
      addonsActor,
      addonId
    )

    if (!console_) return null

    try {
      const probe = (await target.evaluate(
        console_.consoleActor,
        `(() => {
          const api = (typeof globalThis === 'object' && globalThis)
            ? (globalThis.browser || globalThis.chrome || null)
            : null;
          return JSON.stringify({
            hasScripting: !!(api && api.scripting && typeof api.scripting.executeScript === 'function')
          });
        })()`
      )) as unknown
      const raw =
        typeof probe === 'string' ? probe : (probe as {value?: unknown})?.value
      const text = typeof raw === 'string' ? raw : ''

      if (!text) return null

      const parsed = JSON.parse(text) as {hasScripting?: boolean}
      const hasScripting = Boolean(parsed?.hasScripting)

      this.cachedRuntimeCapability = {hasScripting, probedAt: Date.now()}

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        try {
          console.log(
            messages.firefoxRdpRuntimeCapabilitySummary(
              hasScripting ? 'available' : 'unavailable'
            )
          )
        } catch {
          // Do nothing
        }
      }
      return this.cachedRuntimeCapability
    } catch {
      return null
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
