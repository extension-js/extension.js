// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {
  RDP_MAX_RETRIES,
  RDP_RETRY_INTERVAL_MS
} from '../../../browsers-lib/constants'
import {resolvePortForInstance} from '../../../browsers-lib/instance-registry'
import * as messages from '../../../browsers-lib/messages'
import {toExtensionLoadList} from '../../../browsers-lib/runtime-options'
import {deriveDebugPortWithInstance} from '../../../browsers-lib/shared-utils'
import type {CompilationLike} from '../../../browsers-types'
import {type PluginInterface} from '../../../browsers-types'
import {waitForStableExtensionOutput} from '../../../run-chromium/manifest-readiness'
import {
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

export class RemoteFirefox {
  private readonly options: PluginInterface & {
    browserVersionLine?: string
    // The concrete, already-resolved RDP debug port the browser was actually
    // launched on. When set, it is used verbatim — NOT folded back through
    // deriveDebugPortWithInstance. `port` (PluginInterface) is a *base* port to
    // derive from; passing the launched port there would double-apply the
    // offset (e.g. 9230 launched -> 9330 attempted -> ECONNREFUSED, add-on
    // never installs). See resolveRdpPort.
    resolvedRdpPort?: number
  }
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
      resolvedRdpPort?: number
    }
  ) {
    this.options = configOptions
  }

  private resolveRdpPort(compilation?: CompilationLike): number {
    const instanceId = (this.options as {instanceId?: string})?.instanceId
    // A concrete, already-resolved launch port wins outright — it is the actual
    // port Firefox opened its debugger server on, so it must NOT be re-derived
    // (deriving folds the per-instance offset in a SECOND time and we connect to
    // a dead port). The instance registry can only override via instanceId; a
    // plain single-browser `extension dev` run has no instanceId, so without
    // this short-circuit we'd fall through to the doubly-derived `desired`.
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
    // `desired` is a deterministic, per-instance derived port (the instance id
    // is folded into the offset), so it is a safe fallback that stays faithful
    // to this instance. The process-wide last-launched RDP port is never used —
    // that was the cross-talk source when chrome + edge ran from one command.
    const desired = deriveDebugPortWithInstance(basePort, instanceId)

    const resolved = resolvePortForInstance(instanceId, 'rdp', desired)
    return typeof resolved === 'number' && resolved > 0 ? resolved : desired
  }

  private async connectClient(port: number) {
    let lastError

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of Array.from({length: MAX_RETRIES})) {
      try {
        const client = new MessagingClient()
        await client.connect(port)
        this.client = client
        // A new RDP connection invalidates actor IDs from any prior connection
        // (Firefox namespaces them per connection, e.g. server1.conn0.addonsActor2).
        // Clear connection-scoped caches so we re-resolve them on THIS connection
        // — otherwise a retry/reconnect installs against a dead actor and fails
        // with "noSuchActor". Also re-clear if the transport transparently
        // reconnects mid-session.
        this.invalidateConnectionScopedCaches()
        client.on('reconnected', () => this.invalidateConnectionScopedCaches())
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

  /**
   * Drop caches that are only valid for the current RDP connection. Actor IDs
   * (addonsActor and its probed capability) belong to a specific Firefox
   * connection; once we reconnect they must be re-resolved via getRoot.
   */
  private invalidateConnectionScopedCaches(): void {
    this.cachedAddonsActor = undefined
    this.cachedSupportsReload = null
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

    // Best-effort: if no explicit id yet, try to infer from any moz-extension URL
    // target. Reaching here means the install reply carried no id — surface that
    // in author mode so a real regression in the reply is visible instead of
    // silently degrading to a scanned (or absent) banner id.
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
