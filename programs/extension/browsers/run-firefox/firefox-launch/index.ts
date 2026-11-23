// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import * as fs from 'node:fs'
import {getInstallGuidance as getFirefoxInstallGuidance} from 'firefox-location2'
import {getInstallGuidance as getFloorpInstallGuidance} from 'floorp-location'
import {getInstallGuidance as getLibreWolfInstallGuidance} from 'librewolf-location'
import {getInstallGuidance as getWaterfoxInstallGuidance} from 'waterfox-location'
import {getInstallGuidance as getZenInstallGuidance} from 'zen-location'
import {
  CODES,
  hasChannelPrefix,
  humanError,
  humanLine,
  humanWarn,
  isDebug
} from '../../../helpers/messaging'
import {expectedGeckoExtensionId} from '../../browsers-lib/banner'
import {binaryOverrideNaming} from '../../browsers-lib/binary-env-override'
import {setInstancePorts} from '../../browsers-lib/instance-registry'
import {scanSystem} from '../../browsers-lib/locator-env'
import {readGeckoRefusalCause} from '../../browsers-lib/manifest-refusal'
import * as messages from '../../browsers-lib/messages'
import {
  computeBinariesBaseDir,
  computeSharedCacheRoot,
  managedBrowserCacheEnv,
  resolveFromBinaries
} from '../../browsers-lib/output-binaries-resolver'
import {
  envPinnedBinary,
  type PinnedBinaryProblem,
  pinnedBinaryProblem,
  pinnedBinarySpawnError
} from '../../browsers-lib/pinned-binary'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import {
  describeLaunchFailure,
  launchFailureCode,
  readReadyRunId,
  stampReadyBrowserExited,
  stampReadyBrowserLaunch,
  stampReadyBrowserLaunchFailed,
  stampReadyExtensionBaseUrl,
  stampReadyExtensionId,
  stampReadyExtensionLoadRefused,
  stampReadyRdpPort,
  stampReadyRdpPortError
} from '../../browsers-lib/ready-stamp'
import {findLiveBrowserPid} from '../../browsers-lib/resolve-live-pid'
import {
  normalizeProfileOption,
  systemProfileEnvName
} from '../../browsers-lib/resolve-profile'
import {
  buildBrowserLaunchRequest,
  toExtensionLoadList
} from '../../browsers-lib/runtime-options'
import {
  classifyBinaryProvenance,
  deriveDebugPortWithInstance,
  removeManagedEphemeralProfile
} from '../../browsers-lib/shared-utils'
import {isVersionProbeTimeout} from '../../browsers-lib/version-probe'
import type {
  BrowserConfig,
  BrowserLogger,
  BrowserType,
  CompilationLike,
  ExtensionLoadRetryResult
} from '../../browsers-types'
import type {FirefoxContext} from '../firefox-context'
import type {FirefoxPluginRuntime} from '../firefox-types'
import {
  FirefoxBinaryDetector,
  isFirefoxHeadlessRequested,
  parseFlatpakBinary
} from './binary-detector'
import {resolveFirefoxLaunchConfig} from './browser-config'
import {attachChildOutput} from './child-output'
import {logFirefoxDryRun} from './dry-run'
import {
  type FirefoxLaunchDependencies,
  firefoxLaunchDefaults
} from './launch-dependencies'
import {ensureManagedGeckoUpdatePolicy} from './managed-update-policy'
import type {FirefoxBrowserKind} from './process-handlers'
import {removeSessionPreferences} from './session-preferences'
import type {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {
  isWslEnv,
  normalizeBinaryPathForWsl,
  resolveWslLinuxBinary as resolveWslLinuxFirefox,
  resolveWslWindowsBinary
} from './wsl-support'

const DRY_RUN_NO_BROWSER =
  'a dry run prints the Firefox launch plan and starts no browser'

export type LaunchOptions = {
  browser: BrowserType
  mode: 'development' | 'production' | 'none'
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  profile?: string | false
  persistProfile?: boolean
  keepProfileChanges?: boolean
  copyFromProfile?: string
  preferences?: Record<string, unknown>
  startingUrl?: string
  port?: number | string
  noOpen?: boolean
} & BrowserConfig

// Shape of the stats value the injected compiler hands to the done hook;
// tolerates both real rspack Stats and the mock compilers specs pass.
interface FirefoxLaunchDoneStats {
  hasErrors?: () => boolean
  compilation: CompilationLike & {
    options: {mode?: string}
    errors?: unknown[]
  }
}

// The Chromium launcher's twin: thrown with the same code, so a bad pin reads
// the same on either engine.
function invalidBinaryPinError(
  requestedPath: string,
  problem: PinnedBinaryProblem = 'missing'
): Error {
  return Object.assign(
    new Error(
      problem === 'not-executable'
        ? messages.binaryNotExecutable(requestedPath, '--gecko-binary')
        : messages.invalidGeckoBinaryPath(requestedPath)
    ),
    {
      code: CODES.E_BROWSER_BINARY_INVALID
    }
  )
}

// Refused before any spawn: a Gecko browser on its own profile has remote
// debugging off, so it would run with nothing loaded on the user's profile.
function systemProfileRefusal(
  browser: BrowserType,
  sources: messages.SystemProfileSource[]
): Error {
  return Object.assign(
    new Error(messages.geckoSystemProfileRefused(browser, sources)),
    {code: CODES.E_FLAG_NOT_SUPPORTED_HERE}
  )
}

// Every setting that asks for the browser's own profile, so the refusal can
// name each one the user has to change.
function systemProfileSources(host: {
  profile?: string | false
  profileSource?: 'flag' | 'config'
}): messages.SystemProfileSource[] {
  const sources: messages.SystemProfileSource[] = []

  if (normalizeProfileOption(host.profile) === false) {
    sources.push({kind: host.profileSource === 'config' ? 'config' : 'flag'})
  }

  const envName = systemProfileEnvName()

  if (envName) sources.push({kind: 'env', name: envName})

  return sources
}

export class FirefoxLaunchPlugin {
  private readonly host: FirefoxPluginRuntime
  private readonly ctx: FirefoxContext
  private child: ChildProcess | null = null
  private watchTimeout?: NodeJS.Timeout
  // Set before spawn so the child 'close' handler can find the session's
  // ready.json and stamp an unexpected browser exit.
  private extensionOutputPath?: string
  // The run that ready.json belonged to at launch. A stamp is evidence about
  // THIS browser, so a restart's contract must never receive it.
  private launchRunId?: string
  // The process that owns the session once Firefox hands it off and lets the
  // spawned child exit. Null while the child itself is the browser.
  private livePid: number | null = null
  private livePidAdoptedAt = 0
  private livePidStartId: string | undefined
  private liveExitWatcher?: NodeJS.Timeout
  private browserGone = false
  private didReportReady = false
  private disposeProcessHandlers?: () => void
  private readonly deps: FirefoxLaunchDependencies

  constructor(
    host: FirefoxPluginRuntime,
    ctx: FirefoxContext,
    deps: Partial<FirefoxLaunchDependencies> = {}
  ) {
    this.host = host
    this.ctx = ctx
    this.deps = {...firefoxLaunchDefaults, ...deps}
    this.host.isBrowserGone = () => this.browserGone
  }

  // Whether a browser process came to exist, so a caller can tell a launch
  // that never spawned from a failure that followed a live browser.
  public get spawnedBrowser(): boolean {
    return this.child !== null
  }

  // Whether the browser has exited, an adopted process included, so a caller
  // ending the session can wait for the close instead of killing it.
  public get browserClosed(): boolean {
    return this.browserGone
  }

  // Run the Firefox launch flow without a bundler compiler instance;
  // intended for run-only preview paths.
  public async runOnce(
    compilation: CompilationLike,
    options: LaunchOptions
  ): Promise<void> {
    if (!this.ctx.logger) {
      this.ctx.logger = {
        info: (...a: unknown[]) => humanLine(...a),
        warn: (...a: unknown[]) => humanWarn(...a),
        error: (...a: unknown[]) => humanError(...a),
        debug: (...a: unknown[]) => console?.debug?.(...a)
      } as BrowserLogger
    }

    // A skipped launch is not a launch: no ready line, and a later call may
    // still start the browser.
    if (compilation?.errors?.length) {
      this.ctx.logger?.info?.(
        messages.skippingBrowserLaunchDueToCompileErrors()
      )

      return
    }

    try {
      await this.launch(compilation, options)
    } catch (error) {
      this.stampLaunchFailed(error)

      throw error
    }

    // Nothing rebuilds a run-only session, so an add-on the browser refused
    // never loads later and the run ends here with the browser's reason.
    if (options?.mode !== 'development' && this.host.extensionLoadRefused) {
      const reason = this.host.extensionLoadRefused

      await this.cleanupInstance()

      throw Object.assign(
        new Error(
          messages.browserRefusesTheExtension(
            String(this.host.browser),
            this.extensionOutputPath || '',
            reason,
            readGeckoRefusalCause(this.extensionOutputPath)
          )
        ),
        {code: CODES.E_EXTENSION_LOAD_REFUSED}
      )
    }

    // A claim about the browser waits for the browser: printing this before
    // the install announced add-ons Firefox had thrown out.
    if (options?.mode === 'development' && !this.host.extensionLoadRefused) {
      this.reportReady(options.mode)
    }

    this.ctx.didLaunch = true
  }

  // The contract is written by the compile, so a launch that fails before a
  // process exists leaves it saying ready over nothing. Record the failure
  // there, unless a browser did come up and the throw came after it.
  private stampLaunchFailed(error: unknown) {
    if (this.child) return

    const outputPath =
      this.extensionOutputPath ?? this.resolveExtensionOutputPath()

    stampReadyBrowserLaunchFailed(
      outputPath,
      describeLaunchFailure(error),
      this.launchRunId,
      launchFailureCode(error)
    )
  }

  // A dry run starts no Firefox, so there is no debugger port to wait for and
  // the contract says so instead of holding a dev session at starting.
  private stampNoBrowserLaunched(reason: string) {
    const outputPath =
      this.extensionOutputPath ?? this.resolveExtensionOutputPath()

    stampReadyRdpPortError(outputPath, reason, this.launchRunId)
  }

  // The user extension's dist dir anchors ready.json, so companions are
  // filtered out, mirroring getExtensionOutputPath on the Chromium side.
  private resolveExtensionOutputPath(): string | undefined {
    const extensionsToLoad = toExtensionLoadList(this.host.extension)
    const userExtensionCandidates = extensionsToLoad.filter(
      (p) =>
        !/[\\/]extension-js-devtools[\\/]/.test(p) &&
        !/[\\/]extension-js-theme[\\/]/.test(p)
    )

    return (
      userExtensionCandidates.length
        ? userExtensionCandidates
        : extensionsToLoad
    ).slice(-1)[0]
  }

  apply(compiler: unknown) {
    const host = compiler as {
      getInfrastructureLogger?: (name: string) => BrowserLogger
      hooks: {
        done: {
          tapAsync: (
            name: string,
            cb: (
              stats: FirefoxLaunchDoneStats,
              done: (err?: unknown) => void
            ) => Promise<void>
          ) => void
        }
      }
    }
    this.ctx.logger =
      typeof host?.getInfrastructureLogger === 'function'
        ? host.getInfrastructureLogger('FirefoxLaunchPlugin')
        : ({
            info: (...a: unknown[]) => humanLine(...a),
            warn: (...a: unknown[]) => humanWarn(...a),
            error: (...a: unknown[]) => humanError(...a),
            debug: (...a: unknown[]) => console?.debug?.(...a)
          } as BrowserLogger)

    host.hooks.done.tapAsync('run-firefox:launch', async (stats, done) => {
      try {
        const hasErrors =
          typeof stats?.hasErrors === 'function'
            ? stats.hasErrors()
            : !!stats?.compilation?.errors?.length

        if (this.ctx.didLaunch) {
          done()

          return
        }

        if (hasErrors) {
          this.ctx.logger?.info?.(
            messages.skippingBrowserLaunchDueToCompileErrors()
          )

          done()

          return
        }

        await this.launch(
          stats.compilation,
          buildBrowserLaunchRequest(
            this.host,
            stats.compilation.options.mode as
              | 'development'
              | 'production'
              | 'none'
          ) as LaunchOptions
        )

        // Ready comes after the install, and never for an add-on the browser
        // refused. See runOnce above for context.
        if (
          stats.compilation.options.mode === 'development' &&
          !this.host.extensionLoadRefused
        ) {
          this.reportReady('development')
        }

        this.ctx.didLaunch = true
      } catch (error) {
        this.stampLaunchFailed(error)

        const rendered = error instanceof Error ? error.message : String(error)

        // A refusal that framed itself is the whole block already.
        if (hasChannelPrefix(rendered)) {
          humanError(rendered)
        } else {
          this.ctx.logger?.error?.(messages.firefoxFailedToStart(error))
        }

        // The contract carries the failure and its code, so the stream frames
        // it. Exiting here ended a json stream with nothing on it.
      }

      done()
    })
  }

  private async launch(compilation: CompilationLike, options: LaunchOptions) {
    this.extensionOutputPath = this.resolveExtensionOutputPath()
    this.launchRunId = readReadyRunId(this.extensionOutputPath)

    if (isDebug()) {
      this.ctx.logger?.info?.(messages.firefoxLaunchCalled(this.host.browser))
    }

    const systemProfile = systemProfileSources(this.host)

    if (systemProfile.length > 0) {
      throw systemProfileRefusal(this.host.browser, systemProfile)
    }

    const normalizePath = (value?: string | null): string | null => {
      const normalized = value ? normalizeBinaryPathForWsl(value) : null

      return normalized && fs.existsSync(normalized) ? normalized : null
    }

    // A named gecko fork is always located from the user's own system by its
    // own *-location package, never from the managed firefox cache. Claiming
    // the cached firefox here would make every fork target launch firefox.
    const isNamedGeckoFork =
      this.host.browser === 'waterfox' ||
      this.host.browser === 'librewolf' ||
      this.host.browser === 'zen' ||
      this.host.browser === 'floorp'
    const resolveManagedBinary = (): string | null =>
      isNamedGeckoFork
        ? null
        : normalizePath(resolveFromBinaries(compilation, 'firefox') || null)
    const resolveWslFallback = (): string | null =>
      scanSystem(() => resolveWslWindowsBinary())

    const getInstallGuidanceText = (): string => {
      try {
        return getFirefoxInstallGuidance({
          steps: [
            {
              summary: 'Install Firefox into the managed browser cache',
              command: 'npx extension install firefox'
            }
          ]
        })
      } catch {
        return 'npx extension install firefox'
      }
    }

    // A pin that names nothing is thrown, so the command that owns stdout can
    // frame it. Exiting here left a json consumer with exit 1 and no envelope.
    const failGeckoBinaryRequirement = (): never => {
      if (this.host.geckoBinary) {
        throw invalidBinaryPinError(String(this.host.geckoBinary))
      }

      throw Object.assign(
        new Error(messages.requireGeckoBinaryForGeckoBased()),
        {code: CODES.E_BROWSER_BINARY_REQUIRED}
      )
    }

    const throwNotInstalled = (): never => {
      throw Object.assign(
        new Error(
          `${this.host.browser} isn't installed and no binary was found`
        ),
        {code: CODES.E_BROWSER_NOT_FOUND}
      )
    }

    const dryRun = Boolean(this.host.dryRun)

    if (this.host.browser === 'librewolf') {
      const remoteDebugging = this.deps.librewolfRemoteDebugging()

      if (!remoteDebugging.enabled) {
        throw Object.assign(
          new Error(
            messages.librewolfRemoteDebuggingLocked(
              remoteDebugging.expectedPath
            )
          ),
          {code: CODES.E_BROWSER_CONNECT}
        )
      }
    }

    // One order on every target: the flag, the variable the person set, the
    // managed copy, then the system. A bad variable throws here.
    const fromEnv = this.host.geckoBinary
      ? null
      : envPinnedBinary(
          String(this.host.browser),
          process.env,
          normalizeBinaryPathForWsl
        )

    let browserBinaryLocation: string | null = fromEnv
      ? fromEnv.path
      : resolveManagedBinary()
    let skipDetection = Boolean(browserBinaryLocation)
    const engineBased =
      this.host.browser === 'gecko-based' ||
      this.host.browser === 'firefox-based'

    if (!browserBinaryLocation && !engineBased && isWslEnv()) {
      // WSL+GUI: prefer a Linux-native Firefox so the dev loop stays on the Linux
      // side; fall back to the Windows binary via /mnt/c.
      const linuxFallback = scanSystem(() => resolveWslLinuxFirefox())

      if (linuxFallback) {
        browserBinaryLocation = linuxFallback
        skipDetection = true
      } else {
        const wslFallback = resolveWslFallback()

        if (wslFallback) {
          browserBinaryLocation = wslFallback
          skipDetection = true
        }
      }
    }

    // A pin that exists but will not run is refused here, before the block
    // below reads every failure as a path that names nothing.
    if (
      typeof this.host.geckoBinary === 'string' &&
      this.host.geckoBinary &&
      !parseFlatpakBinary(this.host.geckoBinary)
    ) {
      const pinned = normalizePath(this.host.geckoBinary)

      if (pinned && pinnedBinaryProblem(pinned) === 'not-executable') {
        throw invalidBinaryPinError(this.host.geckoBinary, 'not-executable')
      }
    }

    try {
      if (this.host.geckoBinary && typeof this.host.geckoBinary === 'string') {
        // Flatpak: "flatpak:org.mozilla.firefox" is not a filesystem path
        if (parseFlatpakBinary(this.host.geckoBinary)) {
          browserBinaryLocation = this.host.geckoBinary
          skipDetection = true
        } else {
          const normalized = normalizePath(this.host.geckoBinary)

          if (normalized) {
            browserBinaryLocation = normalized
          } else {
            failGeckoBinaryRequirement()
          }
        }
      } else if (!skipDetection) {
        if (engineBased) {
          failGeckoBinaryRequirement()
        } else if (this.host.browser === 'waterfox') {
          // Gecko fork located from the user's system, not a managed download.
          const located = scanSystem(() =>
            this.deps.locate.waterfox(process.env)
          )
          const normalized = normalizePath(located)

          if (normalized) {
            browserBinaryLocation = normalized
          }
        } else if (this.host.browser === 'librewolf') {
          const located = scanSystem(() =>
            this.deps.locate.librewolf(process.env)
          )
          const normalized = normalizePath(located)

          if (normalized) {
            browserBinaryLocation = normalized
          }
        } else if (this.host.browser === 'zen') {
          const located = scanSystem(() => this.deps.locate.zen(process.env))
          const normalized = normalizePath(located)

          if (normalized) {
            browserBinaryLocation = normalized
          }
        } else if (this.host.browser === 'floorp') {
          const located = scanSystem(() => this.deps.locate.floorp(process.env))
          const normalized = normalizePath(located)

          if (normalized) {
            browserBinaryLocation = normalized
          }
        } else {
          const cacheRoot = computeBinariesBaseDir(compilation)
          const env = {
            ...process.env,
            ...managedBrowserCacheEnv(String(cacheRoot), 'firefox')
          }
          const located = scanSystem(() => this.deps.locate.firefox(env))
          const normalized = normalizePath(located)

          if (normalized) {
            browserBinaryLocation = normalized
          }
        }
      }
    } catch (_error) {
      failGeckoBinaryRequirement()
    }

    const isFlatpak = !!parseFlatpakBinary(browserBinaryLocation || '')

    if (
      !isFlatpak &&
      (!browserBinaryLocation ||
        !browserBinaryLocation.trim() ||
        !fs.existsSync(browserBinaryLocation))
    ) {
      const normalizedFallback = resolveManagedBinary()

      if (normalizedFallback) {
        browserBinaryLocation = normalizedFallback
      } else {
        if (engineBased || this.host.geckoBinary) {
          failGeckoBinaryRequirement()
        } else {
          const linuxFallback = scanSystem(() => resolveWslLinuxFirefox())

          if (linuxFallback) {
            browserBinaryLocation = linuxFallback
          } else {
            const wslFallback = resolveWslFallback()

            if (wslFallback) {
              browserBinaryLocation = wslFallback
            } else {
              this.printInstallHint(compilation, getInstallGuidanceText())
              throwNotInstalled()
            }
          }
        }
      }
    }

    const binaryPath = browserBinaryLocation as string
    const wslFallbackBinary =
      isWslEnv() && !engineBased ? resolveWslFallback() : null

    // The identity card names the exact binary this session runs, the same
    // contract the Chromium card keeps. The RDP layer prints the card, so the
    // resolved identity rides the host runtime to it.
    this.host.launchBinaryPath = binaryPath
    this.host.launchBinaryPinnedBy = this.host.geckoBinary
      ? '--gecko-binary'
      : fromEnv?.name ||
        binaryOverrideNaming(String(this.host.browser), binaryPath) ||
        undefined

    this.host.launchBinaryProvenance = classifyBinaryProvenance({
      binaryPath,
      managedCacheRoot: String(computeBinariesBaseDir(compilation) || ''),
      pinnedByFlag: Boolean(this.host.geckoBinary),
      pinnedByEnv: Boolean(this.host.launchBinaryPinnedBy)
    })

    // Flatpak binaries can't be validated or version-checked directly
    if (!isFlatpak) {
      try {
        this.host.browserVersionLine =
          (await this.deps.probeVersion(binaryPath)) || ''
      } catch (error) {
        // A binary that never answers would hang the launch the same way.
        if (isVersionProbeTimeout(error)) throw error
        // Otherwise the banner falls back to the generic browser label
      }
    }

    const desiredDebugPort = deriveDebugPortWithInstance(
      this.host.port,
      this.host.instanceId
    )
    // Held until Firefox is seen on the port or the launch gives up, so a
    // session starting at the same moment is handed the next port.
    const portClaim = await this.deps.claimPort(desiredDebugPort)
    const debugPort = portClaim.port
    setInstancePorts(this.host.instanceId, {rdpPort: debugPort})

    const effectiveInstanceId: string | undefined = this.host.instanceId

    const launchConfig = await resolveFirefoxLaunchConfig(
      compilation,
      {
        ...options,
        extension: this.host.extension,
        profile: this.host.profile,
        preferences: this.host.preferences || {},
        instanceId: effectiveInstanceId
      },
      {provision: !dryRun}
    )
    const {profilePath, binaryArgs: firefoxArgs} = launchConfig

    // The RDP install reads the list off the host, so the staged companion
    // copy has to replace the shared dist there before the install runs.
    if (launchConfig.extensionsToLoad.length > 0) {
      this.host.extension = launchConfig.extensionsToLoad
    }

    // One argv for the printed plan and the spawn.
    const plan = FirefoxBinaryDetector.launchPlan({
      binaryPath,
      profilePath,
      debugPort,
      binaryArgs: firefoxArgs,
      headless: isFirefoxHeadlessRequested()
    })

    if (dryRun) {
      logFirefoxDryRun(
        plan.binary,
        plan.args,
        messages.binarySourceLabel(
          this.host.launchBinaryProvenance,
          this.host.browser,
          this.host.launchBinaryPinnedBy
        )
      )

      this.stampNoBrowserLaunched(DRY_RUN_NO_BROWSER)
      portClaim.release()

      return
    }

    if (!isFlatpak) {
      const policy = ensureManagedGeckoUpdatePolicy({
        binaryPath,
        managedRoots: [
          String(computeBinariesBaseDir(compilation) || ''),
          computeSharedCacheRoot()
        ]
      })

      if (policy.status === 'failed') {
        humanWarn(
          messages.managedGeckoUpdatePolicyFailed(
            policy.policyPath,
            policy.error
          )
        )
      }
    }

    if (profilePath) {
      const {binary, args} = plan
      this.host.launchProfilePath = profilePath

      try {
        this.child = await this.spawnFirefoxChild(
          binary,
          args,
          wslFallbackBinary
        )
      } catch (error) {
        // No browser will bind the port, so the next session may take it.
        portClaim.release()

        throw pinnedBinarySpawnError(error, {
          path: binary,
          pinnedBy: this.host.launchBinaryPinnedBy
        })
      }

      // The contract names the executable that ran, the same fields the
      // Chromium launch stamps, so a reader can tell a fork from Firefox.
      stampReadyBrowserLaunch(
        this.extensionOutputPath,
        {
          profilePath,
          browserPid: this.child?.pid,
          binary: this.child?.spawnfile || binary,
          binaryProvenance: this.host.launchBinaryProvenance,
          binaryPinnedBy: this.host.launchBinaryPinnedBy,
          extensionId: this.extensionOutputPath
            ? expectedGeckoExtensionId(this.extensionOutputPath)
            : undefined
        },
        this.launchRunId
      )

      this.wireChildLifecycle()
      void this.trackLiveBrowserPid()

      const portWait = await this.deps.awaitRdpPort(this.extensionOutputPath, {
        port: debugPort,
        isBrowserGone: () => this.browserGone,
        runId: this.launchRunId
      })

      portClaim.release()

      let ctrl: Awaited<ReturnType<typeof setupRdpAfterLaunch>> | undefined

      try {
        ctrl = await this.deps.setupRdp(
          this.host as FirefoxPluginRuntime & {[k: string]: unknown},
          compilation,
          debugPort
        )

        // The browser is fully up once RDP answers, so a startup handoff has
        // happened by now if it was going to. One more look settles the pid.
        void this.trackLiveBrowserPid(1)
      } catch (error) {
        const reason = (error as {extensionLoadRefusedReason?: string})
          ?.extensionLoadRefusedReason

        // Only Gecko's own verdict is a refusal. Anything else (dead socket,
        // timeout) stays a launch failure and keeps propagating as before.
        if (!reason) {
          if (portWait.open) {
            stampReadyRdpPort(
              this.extensionOutputPath,
              debugPort,
              this.launchRunId
            )
          }

          // A process exists and the add-on never reached it, so the contract
          // cannot go on saying starting or ready. An exit already on it stays.
          stampReadyBrowserLaunchFailed(
            this.extensionOutputPath,
            describeLaunchFailure(error),
            this.launchRunId,
            launchFailureCode(error)
          )

          throw error
        }

        this.reportAddonLoadRefused(
          reason,
          compilation.options?.mode !== 'development'
        )

        // Re-offering the dist needs the port and compilation resolved here,
        // so bind them now; the launcher's controller calls this on recompile.
        this.host.retryAddonInstall = () =>
          this.retryAddonInstall(compilation, debugPort)

        stampReadyRdpPort(this.extensionOutputPath, debugPort, this.launchRunId)
        this.scheduleWatchTimeout()

        return
      }

      this.host.rdpController = ctrl
      this.ctx.setController(ctrl)
      stampReadyRdpPort(this.extensionOutputPath, debugPort, this.launchRunId)
      stampReadyExtensionId(
        this.extensionOutputPath,
        ctrl.getExtensionId(),
        this.launchRunId
      )

      stampReadyExtensionBaseUrl(
        this.extensionOutputPath,
        ctrl.getExtensionBaseUrl(),
        this.launchRunId
      )

      this.scheduleWatchTimeout()

      try {
        if (isDebug()) {
          this.ctx.logger?.info?.(
            messages.devFirefoxDebugPort(debugPort, desiredDebugPort)
          )

          this.ctx.logger?.info?.(messages.devFirefoxProfilePath(profilePath))
        }
      } catch {
        // Ignore
      }
    } else {
      // Unreachable past the refusal at the top of launch, kept so a profile
      // that resolves to nothing can never spawn the browser on its own one.
      throw systemProfileRefusal(this.host.browser, [{kind: 'flag'}])
    }
  }

  private resolveSpawnStdio() {
    if (process.platform !== 'win32') {
      return ['pipe', 'pipe', 'pipe'] as const
    }

    return isDebug()
      ? (['pipe', 'pipe', 'pipe'] as const)
      : (['ignore', 'ignore', 'ignore'] as const)
  }

  private async spawnFirefoxChild(
    binary: string,
    args: string[],
    fallbackBinary?: string | null
  ) {
    return await this.deps.spawn({
      binary,
      args,
      stdio: [...this.resolveSpawnStdio()],
      fallbackBinary,
      logger: this.ctx.logger
    })
  }

  private pipeChildOutput(child: ChildProcess) {
    attachChildOutput(child, {debug: isDebug()})
  }

  private wireChildLifecycle() {
    const child = this.child
    if (!child) return

    // A process that errors after it spawned either closes, which the close
    // handler stamps and reports, or lives on, so the session does too.
    child.on('error', (error) => {
      this.ctx.logger?.error?.(
        messages.browserLaunchError(this.host.browser, error)
      )
    })

    child.on('close', (code, signal) => {
      const expected = this.deps.terminatedByUs(child)

      // Firefox can hand the session to a fresh process and let this one
      // exit. That process owns the profile now, so the session goes on.
      if (!expected && this.adoptHandedOffBrowser()) return

      this.onBrowserGone(code, expected, signal)
    })

    this.pipeChildOutput(child)

    // Captured so the instance leaves the global cleanup registry once the
    // browser, spawned child or adopted process, is gone.
    this.disposeProcessHandlers = this.deps.watchSignals(
      this.host.browser as FirefoxBrowserKind,
      () => this.child,
      () => this.cleanupInstance(),
      () =>
        this.livePid
          ? {
              pid: this.livePid,
              adoptedAt: this.livePidAdoptedAt,
              startId: this.livePidStartId
            }
          : null,
      // A session that exits on a signal is gone before the browser's close
      // event runs, so the fresh profile is reclaimed as the process ends.
      () => removeManagedEphemeralProfile(this.host.launchProfilePath)
    )
  }

  // Every exit path lands here once: the ephemeral profile is reclaimed, an
  // exit nobody asked for is said loudly and stamped, and the registry entry
  // goes away. The profile removal is marker-gated, so a persistent or
  // user-provided profile is never removed.
  // A browser that already left gets the browserless line here, never ready.
  private reportReady(mode: 'development' | 'production') {
    if (this.browserGone) {
      humanError(messages.browserGoneBeforeReady(this.host.browser))

      return
    }

    humanLine(devServerReady(mode, this.host.browser))
    this.didReportReady = true
  }

  private onBrowserGone(
    code: number | null,
    expected: boolean,
    signal?: string | null
  ) {
    if (this.browserGone) return

    this.browserGone = true

    if (this.watchTimeout) {
      clearTimeout(this.watchTimeout)
      this.watchTimeout = undefined
    }

    if (this.liveExitWatcher) {
      clearInterval(this.liveExitWatcher)
      this.liveExitWatcher = undefined
    }

    if (this.host.launchProfilePath) {
      removeSessionPreferences(this.host.launchProfilePath)
      removeManagedEphemeralProfile(this.host.launchProfilePath)
    }

    if (isDebug()) {
      this.ctx.logger?.info?.(messages.browserInstanceExited(this.host.browser))
    }

    if (!expected) {
      this.ctx.logger?.error?.(
        `[browser] ${this.host.browser} exited (${
          code == null ? `signal ${signal || 'unknown'}` : `code ${code}`
        }) without being asked to. The add-on may have been rejected or the browser crashed; the session cannot be driven.`
      )

      stampReadyBrowserExited(
        this.extensionOutputPath,
        code,
        signal ?? null,
        this.launchRunId,
        {beforeReady: !this.didReportReady}
      )
    }

    this.cleanupInstance().catch((err) => {
      if (isDebug()) {
        this.ctx.logger?.error?.(
          `[browser] Cleanup error on child close: ${(err as Error)?.message || err}`
        )
      }
    })

    this.disposeProcessHandlers?.()
    this.disposeProcessHandlers = undefined
  }

  // The spawned pid is published at once; the handoff, when it happens, comes
  // shortly after spawn, so a few seconds of polling correct the contract.
  private async trackLiveBrowserPid(attempts?: number) {
    const child = this.child
    const profilePath = this.host.launchProfilePath
    if (!child?.pid || !profilePath || this.browserGone) return

    try {
      const pid = await this.deps.resolveLivePid({
        profilePath,
        binary: child.spawnfile,
        launcherPid: child.pid,
        attempts
      })

      if (pid && pid !== child.pid && this.child === child) {
        this.adoptLivePid(pid)
      }
    } catch {
      // The spawned pid stands.
    }
  }

  // Called when the spawned child closed on its own: if another process now
  // owns the profile, the browser is alive and that process is the session.
  private adoptHandedOffBrowser(): boolean {
    const profilePath = this.host.launchProfilePath
    const child = this.child
    if (!profilePath || !child || this.browserGone) return false

    try {
      const pid =
        this.livePid ||
        findLiveBrowserPid({
          profilePath,
          binary: child.spawnfile,
          launcherPid: child.pid,
          rows: this.deps.listProcesses()
        })

      if (!pid || pid === this.child?.pid || !this.deps.isPidAlive(pid)) {
        return false
      }

      this.adoptLivePid(pid)

      return true
    } catch {
      return false
    }
  }

  private adoptLivePid(pid: number) {
    if (this.livePid === pid) return

    this.livePid = pid
    this.livePidAdoptedAt = Date.now()
    this.livePidStartId = this.deps.pidStartId(pid)
    stampReadyBrowserLaunch(
      this.extensionOutputPath,
      {
        browserPid: pid,
        launcherPid: this.child?.pid
      },
      this.launchRunId
    )

    if (isDebug()) {
      this.ctx.logger?.info?.(
        `[browser] ${this.host.browser} handed the session to pid ${pid} (launcher pid ${this.child?.pid}).`
      )
    }

    this.watchLivePidExit()
  }

  // A process we did not spawn has no 'close' event, so its exit is probed. Ref'd:
  // after a handoff with a refused add-on it is the only handle keeping us alive.
  private watchLivePidExit() {
    if (this.liveExitWatcher) clearInterval(this.liveExitWatcher)

    this.liveExitWatcher = setInterval(() => {
      const pid = this.livePid
      if (!pid || this.deps.isPidAlive(pid)) return

      clearInterval(this.liveExitWatcher)
      this.liveExitWatcher = undefined
      this.onBrowserGone(null, this.deps.pidTerminatedByUs(pid))
    }, 1000)
  }

  // Re-offer the dist to a browser that refused it. A fresh controller is
  // needed: the refused one was never published and holds a dead install.
  private async retryAddonInstall(
    compilation: CompilationLike,
    debugPort: number
  ): Promise<ExtensionLoadRetryResult> {
    try {
      const ctrl = await this.deps.setupRdp(
        this.host as FirefoxPluginRuntime & {[k: string]: unknown},
        compilation,
        debugPort
      )
      this.host.rdpController = ctrl
      this.ctx.setController(ctrl)
      this.host.extensionLoadRefused = undefined
      stampReadyExtensionId(
        this.extensionOutputPath,
        ctrl.getExtensionId(),
        this.launchRunId
      )

      stampReadyExtensionBaseUrl(
        this.extensionOutputPath,
        ctrl.getExtensionBaseUrl(),
        this.launchRunId
      )

      return {status: 'loaded'}
    } catch (error) {
      const reason = (error as {extensionLoadRefusedReason?: string})
        ?.extensionLoadRefusedReason

      return reason ? {status: 'refused', reason} : {status: 'unknown'}
    }
  }

  // Report a Gecko refusal on every surface Chromium already reports one on:
  // stdout, logs.ndjson, and a non-ready contract. The session stays alive.
  private reportAddonLoadRefused(reason: string, runOnly = false) {
    const refusedPath = this.extensionOutputPath || ''

    // A run-only launch ends on the refusal and prints its own block.
    if (!runOnly) {
      humanError(
        messages.geckoAddonLoadRefused(
          refusedPath,
          reason,
          readGeckoRefusalCause(refusedPath)
        )
      )
    }

    this.host.logSink?.({
      level: 'error',
      text: `extension_load_refused: ${refusedPath}${
        reason ? ` - ${reason}` : ''
      }`,
      source: 'browser'
    })

    stampReadyExtensionLoadRefused(
      this.extensionOutputPath,
      reason,
      this.launchRunId,
      readGeckoRefusalCause(refusedPath)
    )

    this.host.extensionLoadRefused = reason
  }

  private async cleanupInstance(): Promise<void> {
    // Firefox read user.js at startup, so the developer's own file can go
    // back to what it was on any way out, a signal included.
    if (this.host.launchProfilePath) {
      removeSessionPreferences(this.host.launchProfilePath)
    }

    // The RDP socket belongs to the session: closed here so no client is left
    // reconnecting to a browser that is gone.
    this.host.rdpController?.disconnect()

    // The shared teardown owns the kill decision and is idempotent, so a shutdown
    // that already terminated the child here is a no-op.
    this.deps.terminate(this.child, this.host.browser as BrowserType)

    // The child may be long gone while the process it handed the session to
    // still runs on the profile; that one has to end with the session too.
    if (this.livePid && this.livePid !== this.child?.pid) {
      this.deps.terminatePid(this.livePid, this.host.browser as BrowserType)
    }
  }

  private scheduleWatchTimeout() {
    if (this.watchTimeout) return

    const raw =
      process.env.EXTENSION_WATCH_TIMEOUT_MS ||
      process.env.EXTENSION_DEV_WATCH_TIMEOUT_MS ||
      process.env.EXTJS_WATCH_TIMEOUT_MS ||
      process.env.EXTJS_DEV_WATCH_TIMEOUT_MS ||
      ''
    const ms = parseInt(String(raw || ''), 10)
    if (!Number.isFinite(ms) || ms <= 0) return

    this.watchTimeout = setTimeout(() => {
      try {
        this.ctx.logger?.info?.(
          `[browser] Watch timeout reached (${ms}ms). Shutting down.`
        )
      } catch {
        // Ignore
      }

      this.cleanupInstance()
        .catch((err) => {
          if (isDebug()) {
            this.ctx.logger?.error?.(
              `[browser] Cleanup error on watch timeout: ${(err as Error)?.message || err}`
            )
          }
        })
        .finally(() => {
          this.deps.exit(0)
        })
    }, ms)

    if (typeof this.watchTimeout.unref === 'function') {
      this.watchTimeout.unref()
    }
  }

  private printInstallHint(compilation: CompilationLike, raw: string) {
    const forkGuidance = geckoForkInstallGuidance(this.host.browser)

    if (forkGuidance !== null) {
      humanError(
        messages.geckoForkNotInstalled(
          this.host.browser as BrowserType,
          forkGuidance
        )
      )

      return
    }

    try {
      const displayCacheDir = computeBinariesBaseDir(compilation)
      const pretty = messages.prettyPuppeteerInstallGuidance(
        this.host.browser || 'firefox',
        displayCacheDir
      )
      humanError(pretty)
    } catch {
      humanError(raw)
    }
  }
}

// The fork's own location package knows how it is installed on each platform.
function geckoForkInstallGuidance(browser: unknown): string | null {
  const read = (fn: () => string) => {
    try {
      return fn()
    } catch {
      return ''
    }
  }

  switch (browser) {
    case 'waterfox':
      return read(() => getWaterfoxInstallGuidance())
    case 'librewolf':
      return read(() => getLibreWolfInstallGuidance())
    case 'zen':
      return read(() => getZenInstallGuidance())
    case 'floorp':
      return read(() => getFloorpInstallGuidance())
    default:
      return null
  }
}
