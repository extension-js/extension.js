// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {ChildProcess} from 'child_process'
import type {Compilation, Compiler} from '@rspack/core'
import locateFirefox, {
  getInstallGuidance as getFirefoxInstallGuidance,
  getFirefoxVersion
} from 'firefox-location2'
import * as messages from '../../browsers-lib/messages'
import {
  computeBinariesBaseDir,
  resolveFromBinaries
} from '../../browsers-lib/output-binaries-resolver'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../../browsers-lib/shared-utils'
import {setInstancePorts} from '../../browsers-lib/instance-registry'
import {setupFirefoxProcessHandlers} from './process-handlers'
import {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {logFirefoxDryRun} from './dry-run'
import {browserConfig} from './browser-config'
import {FirefoxBinaryDetector} from './binary-detector'
import {
  isWslEnv,
  normalizeBinaryPathForWsl,
  resolveWslWindowsBinary,
  spawnFirefoxProcess
} from './wsl-support'
import type {FirefoxContext} from '../firefox-context'
import type {BrowserConfig, DevOptions} from '../../../webpack-types'
import type {FirefoxPluginRuntime} from '../firefox-types'

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
    compilation: Compilation,
    options: DevOptions & BrowserConfig
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
    this.ctx.logger?.info?.(
      messages.stdoutData(this.host.browser, options.mode)
    )
    this.ctx.didLaunch = true
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tapAsync('run-firefox:launch', async (stats, done) => {
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

        await this.launch(stats.compilation, {
          browser: this.host.browser,
          browserFlags: this.host.browserFlags,
          profile: this.host.profile,
          preferences: this.host.preferences,
          startingUrl: this.host.startingUrl,
          mode: stats.compilation.options.mode as DevOptions['mode'],
          port: this.host.port
        } as DevOptions & BrowserConfig)

        this.ctx.logger?.info?.(
          messages.stdoutData(
            this.host.browser,
            stats.compilation.options.mode as DevOptions['mode']
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
    })
  }

  private async launch(
    compilation: Compilation,
    options: DevOptions & BrowserConfig
  ) {
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
    let browserBinaryLocation: string | null =
      resolveFromBinaries(compilation, 'firefox') || null
    if (browserBinaryLocation) {
      const normalized = normalizeBinaryPathForWsl(browserBinaryLocation)
      browserBinaryLocation =
        normalized && fs.existsSync(normalized) ? normalized : null
    }
    let skipDetection = Boolean(browserBinaryLocation)
    const engineBased =
      this.host.browser === 'gecko-based' ||
      this.host.browser === 'firefox-based'
    if (!browserBinaryLocation && !engineBased && isWslEnv()) {
      const wslFallback = resolveWslWindowsBinary()
      if (wslFallback) {
        browserBinaryLocation = wslFallback
        skipDetection = true
      }
    }

    // Detect Firefox binary via firefox-location2
    try {
      if (this.host.geckoBinary && typeof this.host.geckoBinary === 'string') {
        const normalized = normalizeBinaryPathForWsl(this.host.geckoBinary)
        if (normalized && fs.existsSync(normalized)) {
          browserBinaryLocation = normalized
        } else {
          console.error(messages.invalidGeckoBinaryPath(this.host.geckoBinary))
          process.exit(1)
        }
      } else if (!skipDetection) {
        if (engineBased) {
          console.error(messages.requireGeckoBinaryForGeckoBased())
          process.exit(1)
        } else {
          const located = locateFirefox(true)
          const normalized = located ? normalizeBinaryPathForWsl(located) : null
          if (normalized && fs.existsSync(normalized)) {
            browserBinaryLocation = normalized
          }
        }
      }
    } catch (_error) {
      console.error(
        this.host.geckoBinary
          ? messages.invalidGeckoBinaryPath(this.host.geckoBinary)
          : messages.requireGeckoBinaryForGeckoBased()
      )
      process.exit(1)
    }

    if (
      !browserBinaryLocation ||
      !browserBinaryLocation.trim() ||
      !fs.existsSync(browserBinaryLocation)
    ) {
      // Second-chance resolution from output binaries
      const fallback = resolveFromBinaries(compilation, 'firefox')
      const normalizedFallback = fallback
        ? normalizeBinaryPathForWsl(fallback)
        : null
      if (normalizedFallback && fs.existsSync(normalizedFallback)) {
        browserBinaryLocation = normalizedFallback
      } else {
        if (engineBased || this.host.geckoBinary) {
          console.error(
            this.host.geckoBinary
              ? messages.invalidGeckoBinaryPath(this.host.geckoBinary)
              : messages.requireGeckoBinaryForGeckoBased()
          )
          process.exit(1)
        } else {
          const wslFallback = resolveWslWindowsBinary()
          if (wslFallback) {
            browserBinaryLocation = wslFallback
          } else {
            const guidance = (() => {
              try {
                return getFirefoxInstallGuidance()
              } catch {
                return 'npx extension install firefox'
              }
            })()
            this.printInstallHint(compilation, guidance)
            if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
              throw new Error('Firefox not installed or binary path not found')
            } else {
              process.exit(1)
            }
          }
        }
      }
    }

    // At this point TS: ensure non-null string
    const binaryPath = browserBinaryLocation as string
    const wslFallbackBinary =
      isWslEnv() && !engineBased ? resolveWslWindowsBinary() : null

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

    // Prepare extension(s)
    const extensionsToLoad = Array.isArray(this.host.extension)
      ? [...this.host.extension]
      : [this.host.extension]
    // Publish extension root once (prefer the USER extension path — last string entry)
    try {
      const last = [...extensionsToLoad]
        .reverse()
        .find((e) => typeof e === 'string') as string | undefined
      if (last && typeof this.ctx.setExtensionRoot === 'function') {
        this.ctx.setExtensionRoot(String(last))
      }
    } catch {
      // ignore
    }

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
      preferences: this.host.preferences,
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
      const isWin = process.platform === 'win32'
      // On Windows, use 'pipe' when EXTENSION_AUTHOR_MODE is enabled to allow stdout/stderr piping
      // Otherwise use array form instead of 'ignore' string to ensure proper process handling
      // This prevents the process from being terminated prematurely on Windows
      const stdio: any = isWin
        ? process.env.EXTENSION_AUTHOR_MODE === 'true'
          ? ['pipe', 'pipe', 'pipe']
          : ['ignore', 'ignore', 'ignore']
        : ['pipe', 'pipe', 'pipe']
      this.child = await spawnFirefoxProcess({
        binary,
        args,
        stdio,
        fallbackBinary: wslFallbackBinary,
        logger: this.ctx.logger
      })
      this.wireChildLifecycle(compilation, debugPort, desiredDebugPort)

      // Connect to RDP
      const ctrl = await setupRdpAfterLaunch(
        {...this.host, extensionsToLoad},
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
          '[plugin-browsers] Firefox profile not set; skipping RDP add-on install.'
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

      const isWin = process.platform === 'win32'
      // On Windows, use 'pipe' when EXTENSION_AUTHOR_MODE is enabled to allow stdout/stderr piping
      // Otherwise use array form instead of 'ignore' string to ensure proper process handling
      // This prevents the process from being terminated prematurely on Windows
      const stdio: any = isWin
        ? process.env.EXTENSION_AUTHOR_MODE === 'true'
          ? ['pipe', 'pipe', 'pipe']
          : ['ignore', 'ignore', 'ignore']
        : ['pipe', 'pipe', 'pipe']
      this.child = await spawnFirefoxProcess({
        binary: binaryPath,
        args,
        stdio,
        fallbackBinary: wslFallbackBinary,
        logger: this.ctx.logger
      })
      this.wireChildLifecycle(compilation, debugPort, desiredDebugPort)
      this.scheduleWatchTimeout()
    }
  }

  private wireChildLifecycle(
    compilation: Compilation,
    debugPort: number,
    desiredDebugPort: number
  ) {
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
      this.cleanupInstance().catch(() => {})
    })

    if (process.env.EXTENSION_AUTHOR_MODE === 'true' && child) {
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    }

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
          `[plugin-browsers] Watch timeout reached (${ms}ms). Shutting down.`
        )
      } catch {}
      this.cleanupInstance()
        .catch(() => {})
        .finally(() => {
          process.exit(0)
        })
    }, ms)
    if (typeof this.watchTimeout.unref === 'function') {
      this.watchTimeout.unref()
    }
  }

  private printInstallHint(compilation: Compilation, raw: string) {
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
