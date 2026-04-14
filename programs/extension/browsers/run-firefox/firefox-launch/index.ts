// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {ChildProcess} from 'child_process'
import type {CompilationLike, BrowserLogger} from '../../browsers-types'
import locateFirefox, {
  getInstallGuidance as getFirefoxInstallGuidance,
  getFirefoxVersion
} from 'firefox-location2'
import * as messages from '../../browsers-lib/messages'
import {
  computeBinariesBaseDir,
  managedBrowserCacheEnv,
  resolveFromBinaries
} from '../../browsers-lib/output-binaries-resolver'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../../browsers-lib/shared-utils'
import {setInstancePorts} from '../../browsers-lib/instance-registry'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import {
  buildBrowserLaunchRequest,
  publishUserExtensionRoot,
  toExtensionLoadList
} from '../../browsers-lib/runtime-options'
import {setupFirefoxProcessHandlers} from './process-handlers'
import {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {logFirefoxDryRun} from './dry-run'
import {browserConfig} from './browser-config'
import {FirefoxBinaryDetector, parseFlatpakBinary} from './binary-detector'
import {
  isWslEnv,
  normalizeBinaryPathForWsl,
  resolveWslWindowsBinary,
  spawnFirefoxProcess
} from './wsl-support'
import type {FirefoxContext} from '../firefox-context'
import type {BrowserType, BrowserConfig} from '../../browsers-types'
import type {FirefoxPluginRuntime} from '../firefox-types'

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

export class FirefoxLaunchPlugin {
  private readonly host: FirefoxPluginRuntime
  private readonly ctx: FirefoxContext
  private child: ChildProcess | null = null
  private watchTimeout?: NodeJS.Timeout

  constructor(host: FirefoxPluginRuntime, ctx: FirefoxContext) {
    this.host = host
    this.ctx = ctx
  }

  /**
   * Run the Firefox launch flow without requiring a bundler compiler instance.
   * Intended for run-only preview paths.
   */
  public async runOnce(
    compilation: CompilationLike,
    options: LaunchOptions
  ): Promise<void> {
    // Ensure a logger exists even when no compiler/plugins are involved.
    if (!this.ctx.logger) {
      this.ctx.logger = {
        info: (...a: unknown[]) => console.log(...a),
        warn: (...a: unknown[]) => console.warn(...a),
        error: (...a: unknown[]) => console.error(...a),
        debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
      } as any
    }
    await this.launch(compilation, options)
    if (options.mode === 'development') {
      this.ctx.logger?.info?.(
        messages.stdoutData(this.host.browser, options.mode)
      )
      this.ctx.logger?.info?.(devServerReady(options.mode, this.host.browser))
    }
    this.ctx.didLaunch = true
  }

  apply(compiler: any) {
    this.ctx.logger =
      typeof compiler?.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger('FirefoxLaunchPlugin')
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
          } as BrowserLogger)

    compiler.hooks.done.tapAsync(
      'run-firefox:launch',
      async (stats: any, done: any) => {
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

          // Use console.log so the message is always visible; infrastructureLogging
          // level is 'error' by default, which would suppress logger.info()
          console.log(
            messages.stdoutData(
              this.host.browser,
              stats.compilation.options.mode as
                | 'development'
                | 'production'
                | 'none'
            )
          )
          console.log(
            devServerReady(
              stats.compilation.options.mode as 'development' | 'production',
              this.host.browser
            )
          )

          this.ctx.didLaunch = true
        } catch (error) {
          this.ctx.logger?.error?.(messages.firefoxFailedToStart(error))
          if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
            done(error as any)
            return
          } else {
            process.exit(1)
          }
        }
        done()
      }
    )
  }

  private async launch(compilation: CompilationLike, options: LaunchOptions) {
    // Guard: never launch if compilation has errors
    const compilationErrors: unknown[] = (compilation as any)?.errors || []
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
        return getFirefoxInstallGuidance()
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

    // In test/dry-run contexts, avoid real spawn
    if (
      this.host.dryRun ||
      process.env.VITEST ||
      process.env.VITEST_WORKER_ID
    ) {
      try {
        logFirefoxDryRun('firefox-mock-binary', '--binary-args=""')
      } catch {}
      return
    }

    // Early detection from output binaries (mirrors Chromium path)
    let browserBinaryLocation: string | null = resolveManagedBinary()
    let skipDetection = Boolean(browserBinaryLocation)
    const engineBased =
      this.host.browser === 'gecko-based' ||
      this.host.browser === 'firefox-based'
    if (!browserBinaryLocation && !engineBased && isWslEnv()) {
      const wslFallback = resolveWslFallback()
      if (wslFallback) {
        browserBinaryLocation = wslFallback
        skipDetection = true
      }
    }

    // Detect Firefox binary via firefox-location2
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

    // At this point TS: ensure non-null string
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

      // Optional: validate binary to obtain version (diagnostics)
      try {
        await FirefoxBinaryDetector.validateFirefoxBinary(binaryPath)
      } catch {
        // ignore
      }
    }

    // Prepare extension(s)
    const extensionsToLoad = toExtensionLoadList(this.host.extension)
    publishUserExtensionRoot(
      extensionsToLoad,
      typeof this.ctx.setExtensionRoot === 'function'
        ? this.ctx.setExtensionRoot
        : undefined
    )

    // Compute RDP port with availability check
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

    // Parse config for binary args
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

    // Extract profile path
    const profileMatch = firefoxCfg.match(/--profile="([^"]*)"/)
    if (profileMatch) {
      const profilePath = profileMatch[1]
      const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
        binaryPath,
        profilePath,
        debugPort,
        firefoxArgs
      )
      this.child = await this.spawnFirefoxChild(binary, args, wslFallbackBinary)
      this.wireChildLifecycle()

      // Connect to RDP
      const ctrl = await setupRdpAfterLaunch(
        this.host as FirefoxPluginRuntime & {[k: string]: unknown},
        compilation,
        debugPort
      )
      this.host.rdpController = ctrl
      this.ctx.setController(ctrl, debugPort)
      this.scheduleWatchTimeout()

      try {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.ctx.logger?.info?.(
            messages.devFirefoxDebugPort(debugPort, desiredDebugPort)
          )
          this.ctx.logger?.info?.(messages.devFirefoxProfilePath(profilePath))
        }
      } catch {}
    } else {
      // Launch with default user profile
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.warn?.(
          '[browser] Firefox profile not set; skipping RDP add-on install.'
        )
      }
      const args: string[] = [
        ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
        ...(process.platform === 'win32' ? ['-wait-for-browser'] : []),
        '--foreground',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...firefoxArgs
      ]

      this.child = await this.spawnFirefoxChild(
        binaryPath,
        args,
        wslFallbackBinary
      )
      this.wireChildLifecycle()
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
      stdio: this.resolveSpawnStdio(),
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

    child.on('close', (_code) => {
      if (this.watchTimeout) {
        clearTimeout(this.watchTimeout)
        this.watchTimeout = undefined
      }
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.info?.(
          messages.browserInstanceExited(this.host.browser)
        )
      }
      this.cleanupInstance().catch((err) => {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.ctx.logger?.error?.(
            `[browser] Cleanup error on child close: ${(err as Error)?.message || err}`
          )
        }
      })
    })

    this.pipeChildOutput(child)

    setupFirefoxProcessHandlers(
      this.host.browser as any,
      () => this.child,
      () => this.cleanupInstance()
    )
  }

  private async cleanupInstance(): Promise<void> {
    try {
      if (this.child && !this.child.killed) {
        try {
          this.child.kill('SIGTERM')
        } catch {}
        setTimeout(() => {
          try {
            if (this.child && !this.child.killed) this.child.kill('SIGKILL')
          } catch {}
        }, 2000)
      }
    } catch {}
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
      } catch {}
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
        (this.host.browser as any) || 'firefox',
        raw,
        displayCacheDir
      )
      console.error(pretty)
    } catch {
      console.error(raw)
    }
  }
}
