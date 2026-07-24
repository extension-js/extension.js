// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import * as fs from 'node:fs'
import locateFirefox, {
  getInstallGuidance as getFirefoxInstallGuidance,
  getFirefoxVersion
} from 'firefox-location2'
import locateLibreWolf from 'librewolf-location'
import locateWaterfox from 'waterfox-location'
import {setInstancePorts} from '../../browsers-lib/instance-registry'
import * as messages from '../../browsers-lib/messages'
import {
  computeBinariesBaseDir,
  managedBrowserCacheEnv,
  resolveFromBinaries
} from '../../browsers-lib/output-binaries-resolver'
import {
  gracefulTerminateChild,
  wasTerminatedByUs
} from '../../browsers-lib/process-teardown'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import {
  stampReadyBrowserExited,
  stampReadyRdpPort
} from '../../browsers-lib/ready-stamp'
import {
  buildBrowserLaunchRequest,
  toExtensionLoadList
} from '../../browsers-lib/runtime-options'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear,
  removeManagedEphemeralProfile
} from '../../browsers-lib/shared-utils'
import type {
  BrowserConfig,
  BrowserLogger,
  BrowserType,
  CompilationLike
} from '../../browsers-types'
import type {FirefoxContext} from '../firefox-context'
import type {FirefoxPluginRuntime} from '../firefox-types'
import {
  FirefoxBinaryDetector,
  isFirefoxHeadlessRequested,
  parseFlatpakBinary
} from './binary-detector'
import {browserConfig} from './browser-config'
import {logFirefoxDryRun} from './dry-run'
import {
  type FirefoxBrowserKind,
  setupFirefoxProcessHandlers
} from './process-handlers'
import {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {
  isWslEnv,
  normalizeBinaryPathForWsl,
  resolveWslLinuxBinary as resolveWslLinuxFirefox,
  resolveWslWindowsBinary,
  spawnFirefoxProcess
} from './wsl-support'

type LaunchOptions = {
  browser: BrowserType
  mode: 'development' | 'production' | 'none'
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  profile?: string | false
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

export class FirefoxLaunchPlugin {
  private readonly host: FirefoxPluginRuntime
  private readonly ctx: FirefoxContext
  private child: ChildProcess | null = null
  private watchTimeout?: NodeJS.Timeout
  // Set before spawn so the child 'close' handler can find the session's
  // ready.json and stamp an unexpected browser exit.
  private extensionOutputPath?: string

  constructor(host: FirefoxPluginRuntime, ctx: FirefoxContext) {
    this.host = host
    this.ctx = ctx
  }

  // Run the Firefox launch flow without a bundler compiler instance;
  // intended for run-only preview paths.
  public async runOnce(
    compilation: CompilationLike,
    options: LaunchOptions
  ): Promise<void> {
    if (!this.ctx.logger) {
      this.ctx.logger = {
        info: (...a: unknown[]) => console.log(...a),
        warn: (...a: unknown[]) => console.warn(...a),
        error: (...a: unknown[]) => console.error(...a),
        debug: (...a: unknown[]) => console?.debug?.(...a)
      } as BrowserLogger
    }

    if (options.mode === 'development') {
      this.ctx.logger?.info?.(devServerReady(options.mode, this.host.browser))
    }
    await this.launch(compilation, options)
    this.ctx.didLaunch = true
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
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => console?.debug?.(...a)
          } as BrowserLogger)

    host.hooks.done.tapAsync('run-firefox:launch', async (stats, done) => {
      try {
        const hasErrors =
          typeof stats?.hasErrors === 'function'
            ? stats.hasErrors()
            : !!stats?.compilation?.errors?.length

        if (hasErrors) {
          this.ctx.logger?.info?.(
            messages.skippingBrowserLaunchDueToCompileErrors()
          )
          done()
          return
        }

        if (this.ctx.didLaunch) {
          done()
          return
        }

        // Match Chromium's banner ordering: ready line BEFORE the
        // banner. See runOnce above for context.
        if (stats.compilation.options.mode === 'development') {
          console.log(
            devServerReady(
              stats.compilation.options.mode as 'development' | 'production',
              this.host.browser
            )
          )
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

        this.ctx.didLaunch = true
      } catch (error) {
        this.ctx.logger?.error?.(messages.firefoxFailedToStart(error))
        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          done(error)
          return
        } else {
          process.exit(1)
        }
      }
      done()
    })
  }

  private async launch(compilation: CompilationLike, options: LaunchOptions) {
    const compilationErrors: unknown[] =
      (compilation as {errors?: unknown[]})?.errors || []
    if (compilationErrors.length > 0) {
      this.ctx.logger?.info?.(
        messages.skippingBrowserLaunchDueToCompileErrors()
      )
      return
    }

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      this.ctx.logger?.info?.(messages.firefoxLaunchCalled())
    }

    const normalizePath = (value?: string | null): string | null => {
      const normalized = value ? normalizeBinaryPathForWsl(value) : null
      return normalized && fs.existsSync(normalized) ? normalized : null
    }
    const resolveManagedBinary = (): string | null =>
      normalizePath(resolveFromBinaries(compilation, 'firefox') || null)
    const resolveWslFallback = (): string | null => resolveWslWindowsBinary()
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
    const exitForLaunchFailure = (message?: string): never => {
      if (message) {
        console.error(message)
      }
      process.exit(1)
    }
    const getGeckoBinaryErrorMessage = (): string =>
      this.host.geckoBinary
        ? messages.invalidGeckoBinaryPath(this.host.geckoBinary)
        : messages.requireGeckoBinaryForGeckoBased()
    const failGeckoBinaryRequirement = (): never =>
      exitForLaunchFailure(getGeckoBinaryErrorMessage())
    const throwOrExitNotInstalled = (): never => {
      if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
        throw new Error('Firefox not installed or binary path not found')
      }
      process.exit(1)
    }

    if (
      this.host.dryRun ||
      process.env.VITEST ||
      process.env.VITEST_WORKER_ID
    ) {
      try {
        logFirefoxDryRun('firefox-mock-binary', '--binary-args=""')
      } catch {
        // Ignore
      }
      return
    }

    let browserBinaryLocation: string | null = resolveManagedBinary()
    let skipDetection = Boolean(browserBinaryLocation)
    const engineBased =
      this.host.browser === 'gecko-based' ||
      this.host.browser === 'firefox-based'
    if (!browserBinaryLocation && !engineBased && isWslEnv()) {
      // WSL+GUI: prefer a Linux-native Firefox so the dev loop stays on the Linux
      // side; fall back to the Windows binary via /mnt/c.
      const linuxFallback = resolveWslLinuxFirefox()

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
          const located = locateWaterfox(true, {env: process.env})
          const normalized = normalizePath(located)
          if (normalized) {
            browserBinaryLocation = normalized
          }
        } else if (this.host.browser === 'librewolf') {
          const located = locateLibreWolf(true, {env: process.env})
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
          const located = locateFirefox(true, {env})
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
          const linuxFallback = resolveWslLinuxFirefox()

          if (linuxFallback) {
            browserBinaryLocation = linuxFallback
          } else {
            const wslFallback = resolveWslFallback()

            if (wslFallback) {
              browserBinaryLocation = wslFallback
            } else {
              this.printInstallHint(compilation, getInstallGuidanceText())
              throwOrExitNotInstalled()
            }
          }
        }
      }
    }

    const binaryPath = browserBinaryLocation as string
    const wslFallbackBinary =
      isWslEnv() && !engineBased ? resolveWslFallback() : null

    // Flatpak binaries can't be validated or version-checked directly
    if (!isFlatpak) {
      try {
        this.host.browserVersionLine =
          getFirefoxVersion(binaryPath, {allowExec: true}) || ''
      } catch {
        // best-effort only; banner will fall back to generic browser label
      }
    }

    const extensionsToLoad = toExtensionLoadList(this.host.extension)

    // The user extension's dist dir anchors ready.json; companions are filtered
    // out, mirroring getExtensionOutputPath on the Chromium side.
    const userExtensionCandidates = extensionsToLoad.filter(
      (p) =>
        !/[\\/]extension-js-devtools[\\/]/.test(p) &&
        !/[\\/]extension-js-theme[\\/]/.test(p)
    )
    this.extensionOutputPath = (
      userExtensionCandidates.length
        ? userExtensionCandidates
        : extensionsToLoad
    ).slice(-1)[0]

    const desiredDebugPort = deriveDebugPortWithInstance(
      this.host.port,
      this.host.instanceId
    )
    const debugPort = await findAvailablePortNear(desiredDebugPort)
    setInstancePorts(this.host.instanceId, {rdpPort: debugPort})

    const effectiveInstanceId: string | undefined = this.host.instanceId

    let firefoxCfg: string
    firefoxCfg = await browserConfig(compilation, {
      ...options,
      profile: this.host.profile,
      preferences: this.host.preferences || {},
      instanceId: effectiveInstanceId
    })

    if (this.host.dryRun) {
      logFirefoxDryRun(binaryPath, firefoxCfg)
      return
    }

    const firefoxArgs: string[] = []
    const binaryArgsMatch = firefoxCfg.match(/--binary-args="([^"]*)"/)
    if (binaryArgsMatch) {
      const rawArgs = String(binaryArgsMatch[1] || '').trim()
      if (rawArgs) {
        firefoxArgs.push(
          ...rawArgs.split(' ').filter((arg) => arg.trim().length > 0)
        )
      }
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.info?.(
          messages.firefoxBinaryArgsExtracted(binaryArgsMatch[1])
        )
      }
    } else {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.info?.(messages.firefoxNoBinaryArgsFound())
      }
    }

    const profileMatch = firefoxCfg.match(/--profile="([^"]*)"/)
    if (profileMatch) {
      const profilePath = profileMatch[1]
      const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
        binaryPath,
        profilePath,
        debugPort,
        firefoxArgs,
        isFirefoxHeadlessRequested()
      )
      this.child = await this.spawnFirefoxChild(binary, args, wslFallbackBinary)
      // Reclaim the ephemeral profile once the browser exits. Marker-gated, so
      // a persistent ('dev') or user-provided profile is never removed
      this.child.on('close', () => {
        removeManagedEphemeralProfile(profilePath)
      })
      this.wireChildLifecycle()

      const ctrl = await setupRdpAfterLaunch(
        this.host as FirefoxPluginRuntime & {[k: string]: unknown},
        compilation,
        debugPort
      )
      this.host.rdpController = ctrl
      this.ctx.setController(ctrl)
      stampReadyRdpPort(this.extensionOutputPath, debugPort)
      this.scheduleWatchTimeout()

      try {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.ctx.logger?.info?.(
            messages.devFirefoxDebugPort(debugPort, desiredDebugPort)
          )
          this.ctx.logger?.info?.(messages.devFirefoxProfilePath(profilePath))
        }
      } catch {
        // Ignore
      }
    } else {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.warn?.(
          '[browser] Firefox profile not set; skipping RDP add-on install.'
        )
      }
      const args: string[] = [
        ...(isFirefoxHeadlessRequested() ? ['-headless'] : []),
        ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
        ...(process.platform === 'win32' ? ['-wait-for-browser'] : []),
        ...(isFirefoxHeadlessRequested() ? [] : ['--foreground']),
        ...firefoxArgs
      ]

      this.child = await this.spawnFirefoxChild(
        binaryPath,
        args,
        wslFallbackBinary
      )
      this.wireChildLifecycle()
      if (debugPort > 0) {
        stampReadyRdpPort(this.extensionOutputPath, debugPort)
      }
      this.scheduleWatchTimeout()
    }
  }

  private resolveSpawnStdio() {
    if (process.platform !== 'win32') {
      return ['pipe', 'pipe', 'pipe'] as const
    }

    return process.env.EXTENSION_AUTHOR_MODE === 'true'
      ? (['pipe', 'pipe', 'pipe'] as const)
      : (['ignore', 'ignore', 'ignore'] as const)
  }

  private async spawnFirefoxChild(
    binary: string,
    args: string[],
    fallbackBinary?: string | null
  ) {
    return await spawnFirefoxProcess({
      binary,
      args,
      stdio: [...this.resolveSpawnStdio()],
      fallbackBinary,
      logger: this.ctx.logger
    })
  }

  private pipeChildOutput(child: ChildProcess) {
    if (process.env.EXTENSION_AUTHOR_MODE !== 'true') return

    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
  }

  private wireChildLifecycle() {
    const child = this.child
    if (!child) return

    child.on('error', (error) => {
      this.ctx.logger?.error?.(
        messages.browserLaunchError(this.host.browser, error)
      )
      if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
        throw new Error('Firefox startup timed out')
      } else {
        process.exit(1)
      }
    })

    // Captured below from setupFirefoxProcessHandlers and called once the child
    // exits, so this instance is unregistered from the global cleanup registry.
    let disposeProcessHandlers: (() => void) | undefined

    child.on('close', (code) => {
      if (this.watchTimeout) {
        clearTimeout(this.watchTimeout)
        this.watchTimeout = undefined
      }
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.info?.(
          messages.browserInstanceExited(this.host.browser)
        )
      }
      // An unexpected Gecko exit used to be fully silent. Say so loudly and stamp
      // the contract so automation sees the session is browserless.
      if (!wasTerminatedByUs(child)) {
        this.ctx.logger?.error?.(
          `[browser] ${this.host.browser} exited (code ${
            code ?? 'unknown'
          }) without being asked to. The add-on may have been rejected or the browser crashed; the session cannot be driven.`
        )
        stampReadyBrowserExited(this.extensionOutputPath, code)
      }
      this.cleanupInstance().catch((err) => {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.ctx.logger?.error?.(
            `[browser] Cleanup error on child close: ${(err as Error)?.message || err}`
          )
        }
      })
      disposeProcessHandlers?.()
    })

    this.pipeChildOutput(child)

    disposeProcessHandlers = setupFirefoxProcessHandlers(
      this.host.browser as FirefoxBrowserKind,
      () => this.child,
      () => this.cleanupInstance()
    )
  }

  private async cleanupInstance(): Promise<void> {
    // The shared teardown owns the kill decision and is idempotent, so a shutdown
    // that already terminated the child here is a no-op.
    gracefulTerminateChild(this.child, this.host.browser as BrowserType)
  }

  private scheduleWatchTimeout() {
    if (this.watchTimeout) return
    if (process.env.VITEST || process.env.VITEST_WORKER_ID) return
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
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            this.ctx.logger?.error?.(
              `[browser] Cleanup error on watch timeout: ${(err as Error)?.message || err}`
            )
          }
        })
        .finally(() => {
          process.exit(0)
        })
    }, ms)
    if (typeof this.watchTimeout.unref === 'function') {
      this.watchTimeout.unref()
    }
  }

  private printInstallHint(compilation: CompilationLike, raw: string) {
    try {
      const displayCacheDir = computeBinariesBaseDir(compilation)
      const pretty = messages.prettyPuppeteerInstallGuidance(
        this.host.browser || 'firefox',
        raw,
        displayCacheDir
      )
      console.error(pretty)
    } catch {
      console.error(raw)
    }
  }
}
