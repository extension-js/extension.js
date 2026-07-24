// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  RDP_MAX_RETRIES,
  RDP_RETRY_INTERVAL_MS
} from '../../../browsers-lib/constants'
import {resolvePortForInstance} from '../../../browsers-lib/instance-registry'
import * as messages from '../../../browsers-lib/messages'
import {toExtensionLoadList} from '../../../browsers-lib/runtime-options'
import {deriveDebugPortWithInstance} from '../../../browsers-lib/shared-utils'
import type {CompilationLike, PluginInterface} from '../../../browsers-types'
import {waitForStableExtensionOutput} from '../../../run-chromium/manifest-readiness'
import {
  classifyAddonInstallFailure,
  computeCandidateAddonPaths,
  getAddonsActorWithRetry,
  installTemporaryAddon,
  waitForManagerWelcome
} from './addons-install'
import {printRunningInDevelopmentSummary} from './firefox-utils'
import {attachConsoleListeners, subscribeUnifiedLogging} from './logging'
import {isErrorWithCode, requestErrorToMessage} from './message-utils'
import {MessagingClient} from './messaging-client'
import {deriveMozExtensionId} from './moz-id'

const MAX_RETRIES = RDP_MAX_RETRIES
const RETRY_INTERVAL = RDP_RETRY_INTERVAL_MS
const RETRY_LOG_EVERY_N_ATTEMPTS = 10

export class RemoteFirefox {
  private readonly options: PluginInterface & {
    browserVersionLine?: string
    // The already-resolved RDP port the browser launched on; used verbatim.
    // Deriving from it would double-apply the offset. See resolveRdpPort.
    resolvedRdpPort?: number
  }
  private client: MessagingClient | null = null
  private loggingAttached = false
  private cachedAddonsActor: string | undefined
  private lastInstalledAddonPath: string | undefined
  private derivedExtensionId: string | undefined
  private addonInstallRefusalReason: string | undefined

  // Gecko's own words for why it threw the add-on out, or null when the
  // install never got an answer. Read by the launcher after a failed install.
  public getAddonInstallRefusalReason(): string | null {
    return this.addonInstallRefusalReason || null
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
      resolvedRdpPort?: number
    }
  ) {
    this.options = configOptions
  }

  private resolveRdpPort(compilation?: CompilationLike): number {
    const instanceId = (this.options as {instanceId?: string})?.instanceId
    // A concrete launch port wins outright and must NOT be re-derived: deriving
    // folds the per-instance offset in a SECOND time and dials a dead port.
    const resolvedRdpPort = (this.options as {resolvedRdpPort?: number})
      ?.resolvedRdpPort
    if (typeof resolvedRdpPort === 'number' && resolvedRdpPort > 0) {
      const pinned = resolvePortForInstance(instanceId, 'rdp', resolvedRdpPort)
      return typeof pinned === 'number' && pinned > 0 ? pinned : resolvedRdpPort
    }
    const devPort = (compilation?.options as {devServer?: {port?: number}})
      ?.devServer?.port
    const optionPort = (this.options as {port?: number | string})?.port
    const normalizedOptionPort =
      typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
    const basePort = (normalizedOptionPort as number) || devPort
    // `desired` is a deterministic per-instance derived port, a safe fallback.
    // The process-wide last-launched RDP port caused chrome+edge cross-talk.
    const desired = deriveDebugPortWithInstance(basePort, instanceId)

    const resolved = resolvePortForInstance(instanceId, 'rdp', desired)
    return typeof resolved === 'number' && resolved > 0 ? resolved : desired
  }

  private async connectClient(port: number) {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const client = new MessagingClient()
        await client.connect(port)
        this.client = client
        // A new RDP connection invalidates prior actor IDs (namespaced per
        // connection); clear caches so a retry never targets a dead actor.
        this.invalidateConnectionScopedCaches()
        client.on('reconnected', () => this.invalidateConnectionScopedCaches())
        return client
      } catch (error: unknown) {
        if (isErrorWithCode('ECONNREFUSED', error)) {
          lastError = error
          // ECONNREFUSED is the expected "server not up yet" case, but a silent
          // loop hides a dead port; name the port periodically so it's diagnosable.
          if (attempt % RETRY_LOG_EVERY_N_ATTEMPTS === 0) {
            console.log(
              messages.waitingForBrowserDebugger(
                this.options.browser,
                port,
                attempt,
                MAX_RETRIES
              )
            )
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL))
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

    console.error(messages.errorConnectingToBrowser(this.options.browser, port))
    throw lastError
  }

  // Actor IDs belong to a specific Firefox connection; once we reconnect
  // they must be re-resolved via getRoot.
  private invalidateConnectionScopedCaches(): void {
    this.cachedAddonsActor = undefined
  }

  public async installAddons(compilation: CompilationLike) {
    const {devtools} = this.options

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
    const addonsActor: string | undefined = await getAddonsActorWithRetry(
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
        // Ignore
      }
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      try {
        console.log('[browser] Firefox add-on paths:', candidateAddonPaths)
      } catch {
        // Ignore
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
        // Keep Gecko's own verdict before it is flattened into a string: the
        // launcher reports it and stamps the contract, as Chromium does.
        const outcome = classifyAddonInstallFailure(err)
        if (outcome.status === 'refused') {
          this.addonInstallRefusalReason = outcome.reason
        }

        const message = requestErrorToMessage(err)
        throw new Error(
          messages.addonInstallError(this.options.browser, message)
        )
      }
    }

    if (primaryUserAddonId) {
      this.derivedExtensionId = primaryUserAddonId
    }

    // Best-effort: if no explicit id yet, infer from any moz-extension URL target.
    // Author mode surfaces a missing install-reply id instead of degrading silently.
    try {
      if (!this.derivedExtensionId) {
        this.derivedExtensionId = await deriveMozExtensionId(client)
        if (
          process.env.EXTENSION_AUTHOR_MODE === 'true' &&
          !this.derivedExtensionId
        ) {
          console.warn(
            '[browser] Firefox: could not resolve a unique add-on id for the banner (install response had none; multiple or zero moz-extension targets).'
          )
        }
      }
    } catch {
      // Ignore
    }

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

      await attachConsoleListeners(client)

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
