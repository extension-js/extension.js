import * as fs from 'fs'
import {spawn, ChildProcess} from 'child_process'
import {type Compilation, type Compiler} from '@rspack/core'
import firefoxLocation from 'firefox-location2'
import {browserConfig} from './firefox/browser-config'
import {
  computeBinariesBaseDir,
  resolveFromBinaries
} from '../browsers-lib/output-binaries-resolver'
import {FirefoxBinaryDetector} from './firefox/binary-detector'
import {setupFirefoxProcessHandlers} from './process-handlers'
import {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {logFirefoxDryRun} from './dry-run'
import {FirefoxDoneReloadPlugin} from './done-reload'
import * as messages from '../browsers-lib/messages'
import {setInstancePorts} from '../browsers-lib/instance-registry'
import {
  LogContext,
  LogFormat,
  LogLevel,
  type PluginInterface
} from '../browsers-types'
import type {BrowserConfig, DevOptions} from '../../webpack-types'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../browsers-lib/shared-utils'
import {SetupFirefoxInspectionStep} from './remote-firefox/setup-firefox-inspection'

let child: ChildProcess | null = null

export class RunFirefoxPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly noOpen?: boolean
  public readonly browserFlags?: string[]
  public readonly excludeBrowserFlags?: string[]
  public readonly profile?: string | false
  public readonly preferences?: Record<string, unknown>
  public readonly startingUrl?: string
  public readonly autoReload?: boolean
  public readonly stats?: boolean
  public readonly geckoBinary?: string
  public readonly port?: number | string
  public readonly instanceId?: string
  public readonly keepProfileChanges?: boolean
  public readonly copyFromProfile?: string
  public readonly source?: string | boolean
  public readonly watchSource?: boolean
  public readonly dryRun?: boolean
  // Unified logging flags (parity with Chromium path)
  private logLevel?: LogLevel
  private logContexts?: Array<LogContext>
  private logFormat?: LogFormat
  private logTimestamps?: boolean
  private logColor?: boolean
  private logUrl?: string
  private logTab?: number | string

  private remoteFirefox?: unknown | null
  private logger?: ReturnType<Compiler['getInfrastructureLogger']>
  private pendingHardReloadReason?: 'manifest' | 'locales'

  constructor(options: PluginInterface) {
    // Path(s) to the extension(s) to load.
    // In our case, it's always 'dist/<browser>'
    this.extension = options.extension

    // Browser binary-related kung fu
    this.browser = options.browser
    this.startingUrl = options.startingUrl
    this.preferences = options.preferences
    this.profile = options.profile
    this.browserFlags = options.browserFlags
    this.excludeBrowserFlags = options.excludeBrowserFlags
    this.noOpen = options.noOpen

    // Supplementary browser binary path. Will
    // override the browser setting if provided.
    this.geckoBinary = options.geckoBinary

    // Instance/port coordination for remote
    // debugging and multi-instance runs
    this.instanceId = options.instanceId
    this.port = options.port

    // Source inspection (development mode):
    // For Chromium/Firefox: open a page and extract
    // full HTML (incl. content-script Shadow DOM)
    // Optional watch mode to re-print HTML on file changes
    this.source = options.source
    this.watchSource = options.watchSource

    // Unified logging for Chromium via CDP
    // (levels, contexts, formatting, timestamps, color)
    this.logLevel = options.logLevel
    this.logContexts = options.logContexts
    this.logFormat = options.logFormat
    this.logTimestamps = options.logTimestamps
    this.logColor = options.logColor
    this.logUrl = options.logUrl
    this.logTab = options.logTab

    // Dry run mode (no browser launch) for CI and diagnostics
    this.dryRun = options.dryRun
  }

  private async launchFirefox(
    compilation: Compilation,
    options: DevOptions & BrowserConfig
  ) {
    // Extra guard: never launch if compilation has errors
    const compilationErrors: unknown[] = (compilation as any)?.errors || []

    if (compilationErrors.length > 0) {
      this.logger?.info(messages.skippingBrowserLaunchDueToCompileErrors())
      return
    }

    if (process.env.EXTENSION_ENV === 'development') {
      this.logger?.info(messages.firefoxLaunchCalled())
    }

    // In test/dry-run contexts, do not attempt to detect or spawn real binaries
    if (this.dryRun || process.env.VITEST || process.env.VITEST_WORKER_ID) {
      try {
        // Emit a minimal dry-run log for test visibility
        logFirefoxDryRun('firefox-mock-binary', '--binary-args=""')
      } catch {}
      return
    }

    // Early detection from output binaries (mirrors Chromium path)
    let browserBinaryLocation: string | null =
      resolveFromBinaries(compilation, 'firefox') || null
    const skipDetection = Boolean(browserBinaryLocation)
    const engineBased =
      this.browser === 'gecko-based' || this.browser === 'firefox-based'
    // Detect Firefox binary via firefox-location2 (parity with Chromium behavior)
    try {
      if (this.geckoBinary && typeof this.geckoBinary === 'string') {
        if (fs.existsSync(this.geckoBinary)) {
          browserBinaryLocation = this.geckoBinary
        } else {
          console.error(messages.invalidGeckoBinaryPath(this.geckoBinary))
          process.exit(1)
        }
      } else if (!skipDetection) {
        if (engineBased) {
          console.error(messages.requireGeckoBinaryForGeckoBased())
          process.exit(1)
        } else {
          const locate = (firefoxLocation as any).default || firefoxLocation
          browserBinaryLocation =
            typeof locate === 'function' ? locate(true) : null
        }
      }
    } catch (error) {
      console.error(
        this.geckoBinary
          ? messages.invalidGeckoBinaryPath(this.geckoBinary)
          : messages.requireGeckoBinaryForGeckoBased()
      )
      process.exit(1)
    }

    if (
      !browserBinaryLocation ||
      !browserBinaryLocation.trim() ||
      !fs.existsSync(browserBinaryLocation)
    ) {
      // Second-chance: attempt resolution from output binaries again
      const fallback = resolveFromBinaries(compilation, 'firefox')

      if (fallback && fs.existsSync(fallback)) {
        browserBinaryLocation = fallback
      } else {
        if (engineBased || this.geckoBinary) {
          console.error(
            this.geckoBinary
              ? messages.invalidGeckoBinaryPath(this.geckoBinary)
              : messages.requireGeckoBinaryForGeckoBased()
          )
          process.exit(1)
        } else {
          // Streamlined: show guidance and exit
          const guidance = (() => {
            try {
              const f = (firefoxLocation as any)?.getInstallGuidance
              const txt = typeof f === 'function' ? f() : ''
              return txt && typeof txt === 'string'
                ? txt
                : 'npx @puppeteer/browsers install firefox'
            } catch {
              return 'npx @puppeteer/browsers install firefox'
            }
          })()

          this.printEnhancedPuppeteerInstallHint(compilation, guidance)
          if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
            throw new Error('Firefox not installed or binary path not found')
          } else {
            process.exit(1)
          }
        }
      }
    }

    // Optional: validate binary to obtain version (kept for diagnostics)
    try {
      await FirefoxBinaryDetector.validateFirefoxBinary(browserBinaryLocation)
    } catch (_) {
      // Ignore validation failures here. Binary existence is already ensured
    }

    // Prepare user extension(s) to forward into the RemoteFirefox setup
    const extensionsToLoad = Array.isArray(this.extension)
      ? [...this.extension]
      : [this.extension]

    // Debug port (shared helper) with availability check
    const desiredDebugPort = deriveDebugPortWithInstance(
      this.port,
      this.instanceId
    )
    const debugPort = await findAvailablePortNear(desiredDebugPort)
    // Record actual RDP port for this instance for downstream steps (parity with CDP)
    setInstancePorts(this.instanceId, {rdpPort: debugPort})

    const effectiveInstanceId: string | undefined = this.instanceId

    let firefoxConfig: string
    try {
      firefoxConfig = await browserConfig(compilation, {
        ...options,
        profile: this.profile,
        preferences: this.preferences,
        instanceId: effectiveInstanceId // unique profiles when concurrent
      })
    } catch (error) {
      throw error
    }

    if (this.dryRun) {
      logFirefoxDryRun(browserBinaryLocation, firefoxConfig)
      return
    }

    // Parse the browser config to extract arguments
    const firefoxArgs: string[] = []

    // Extract binary args
    const binaryArgsMatch = firefoxConfig.match(/--binary-args="([^"]*)"/)
    if (binaryArgsMatch) {
      firefoxArgs.push(...binaryArgsMatch[1].split(' '))
      if (process.env.EXTENSION_ENV === 'development') {
        this.logger?.info(
          messages.firefoxBinaryArgsExtracted(binaryArgsMatch[1])
        )
      }
    } else {
      if (process.env.EXTENSION_ENV === 'development') {
        this.logger?.info(messages.firefoxNoBinaryArgsFound())
      }
    }

    // Extract profile path (optional when profile === false)
    const profileMatch = firefoxConfig.match(/--profile="([^"]*)"/)
    if (profileMatch) {
      const profilePath = profileMatch[1]

      // Generate Firefox arguments based on binary type
      // Use -start-debugger-server to start Firefox's RDP server
      const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
        browserBinaryLocation,
        profilePath,
        debugPort, // Pass the debug port to start the RDP server
        firefoxArgs
      )

      // Launch Firefox with enhanced binary detection
      child = spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      })

      child.on('error', (error) => {
        this.logger?.error(messages.browserLaunchError(this.browser, error))
        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          throw new Error('Firefox startup timed out')
        } else {
          process.exit(1)
        }
      })

      child.on('close', (code) => {
        if (process.env.EXTENSION_ENV === 'development') {
          this.logger?.info(messages.browserInstanceExited(this.browser))
        }
        // Ensure instance cleanup even if process is closing independently
        this.cleanupInstance().finally(() => {
          process.exit()
        })
      })

      if (process.env.EXTENSION_ENV === 'development' && child) {
        child.stdout?.pipe(process.stdout)
        child.stderr?.pipe(process.stderr)
      }

      // Enhanced signal handling: ensure child is terminated on parent exit
      setupFirefoxProcessHandlers(
        this.browser as any,
        () => child,
        () => this.cleanupInstance()
      )

      // Connect to Firefox RDP server will be handled by the client with retries
      try {
        const ctrl = await setupRdpAfterLaunch(
          {...(this as any), extensionsToLoad},
          compilation,
          debugPort
        )
        ;(this as any).rdpController = ctrl
      } catch (error) {
        this.logger?.error(messages.browserLaunchError(this.browser, error))
        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          throw new Error('Firefox inspector initialization failed')
        } else {
          process.exit(1)
        }
      }

      try {
        if (
          process.env.EXTENSION_ENV === 'development' &&
          this.instanceId &&
          profileMatch
        ) {
          this.logger?.info(
            messages.devFirefoxDebugPort(debugPort, desiredDebugPort)
          )
          this.logger?.info(messages.devFirefoxProfilePath(profileMatch[1]))
        }
      } catch {}
    } else {
      // No explicit profile specified: launch with default user profile
      const args: string[] = [
        ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
        '--foreground',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...firefoxArgs
      ]

      let binary = browserBinaryLocation
      let finalArgs = args
      if (browserBinaryLocation === 'flatpak') {
        binary = 'flatpak'
        finalArgs = ['run', 'org.mozilla.firefox', ...args]
      }

      child = spawn(binary, finalArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      })

      child.on('error', (error) => {
        this.logger?.error(messages.browserLaunchError(this.browser, error))
        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          throw new Error('Firefox debugging setup failed')
        } else {
          process.exit(1)
        }
      })

      child.on('close', (code) => {
        if (process.env.EXTENSION_ENV === 'development') {
          this.logger?.info(messages.browserInstanceExited(this.browser))
        }

        this.cleanupInstance().finally(() => {
          process.exit()
        })
      })

      if (process.env.EXTENSION_ENV === 'development' && child) {
        child.stdout?.pipe(process.stdout)
        child.stderr?.pipe(process.stderr)
      }

      setupFirefoxProcessHandlers(
        this.browser as any,
        () => child,
        () => this.cleanupInstance()
      )
    }
  }

  private printEnhancedPuppeteerInstallHint(
    compilation: Compilation,
    raw: string
  ): void {
    try {
      const displayCacheDir = computeBinariesBaseDir(compilation)
      const pretty = messages.prettyPuppeteerInstallGuidance(
        (this.browser as any) || 'firefox',
        raw,
        displayCacheDir
      )
      console.error(pretty)
    } catch {
      console.error(raw)
    }
  }

  private createFallbackLogger(): ReturnType<
    Compiler['getInfrastructureLogger']
  > {
    return {
      info: (...a: unknown[]) => console.log(...a),
      warn: (...a: unknown[]) => console.warn(...a),
      error: (...a: unknown[]) => console.error(...a),
      debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
    } as ReturnType<Compiler['getInfrastructureLogger']>
  }

  private handleMissingBinary(binaryPath: string | null): never {
    // Present a pretty guidance box when Firefox is missing.
    const guidance = (() => {
      try {
        const f = (firefoxLocation as any)?.getInstallGuidance
        const txt = typeof f === 'function' ? f() : ''
        return txt && typeof txt === 'string'
          ? txt
          : 'npx @puppeteer/browsers install firefox'
      } catch {
        return 'npx @puppeteer/browsers install firefox'
      }
    })()

    try {
      // No compilation context available here; use empty cache dir
      console.error(
        messages.prettyPuppeteerInstallGuidance(
          (this.browser as any) || 'firefox',
          guidance,
          ''
        )
      )
    } catch {
      console.error(guidance)
    }

    if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
      throw new Error('Firefox not installed or binary path not found')
    } else {
      process.exit(1)
    }
  }

  apply(compiler: Compiler) {
    let firefoxDidLaunch = false
    this.remoteFirefox = this.remoteFirefox || null

    this.logger =
      typeof compiler.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger(RunFirefoxPlugin.name)
        : this.createFallbackLogger()

    // Detect manifest/locales changes as early as possible (source files)
    if (compiler?.hooks?.watchRun?.tapAsync) {
      compiler.hooks.watchRun.tapAsync(
        'run-browsers:watch',
        (compilation, done) => {
          try {
            const files = compilation?.modifiedFiles || new Set<string>()
            const normalizedFilePaths = Array.from(files).map((filePath) =>
              filePath.replace(/\\/g, '/')
            )

            const hitManifest = normalizedFilePaths.some((filePath) =>
              /(^|\/)manifest\.json$/i.test(filePath)
            )
            const hitLocales = normalizedFilePaths.some((filePath) =>
              /(^|\/)__?locales\/.+\.json$/i.test(filePath)
            )

            if (hitManifest) this.pendingHardReloadReason = 'manifest'
            else if (hitLocales) this.pendingHardReloadReason = 'locales'
          } catch (error) {
            this.logger?.warn?.(
              '[reload] watchRun inspect failed:',
              String(error)
            )
          }
          done()
        }
      )
    }

    compiler.hooks.done.tapAsync('run-firefox:module', async (stats, done) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        try {
          const compileErrors = stats?.compilation?.errors || []
          const manifestErrors = compileErrors.filter((err) => {
            const msg: string = String(
              (err && (err.message || err.toString())) || ''
            )
            return (
              msg.includes('manifest.json') && msg.includes('File Not Found')
            )
          })
          if (manifestErrors.length) {
            this.logger?.warn(
              messages.manifestPreflightSummary(manifestErrors.length)
            )
          }
        } catch {}

        this.logger?.info(messages.skippingBrowserLaunchDueToCompileErrors())
        done()
        return
      }

      if (firefoxDidLaunch) {
        // Delegate reload logic to sub-plugin that calls controller.hardReload
        done()
        return
      }

      try {
        await this.launchFirefox(stats.compilation, {
          browser: this.browser,
          browserFlags: this.browserFlags,
          profile: this.profile,
          preferences: this.preferences,
          startingUrl: this.startingUrl,
          mode: stats.compilation.options.mode as DevOptions['mode'],
          port: this.port
        })

        // Show success message after Firefox has successfully started and add-ons installed
        this.logger?.info(
          messages.stdoutData(
            this.browser,
            stats.compilation.options.mode as DevOptions['mode']
          )
        )

        firefoxDidLaunch = true
      } catch (error) {
        // Don't show success message if Firefox failed to start
        this.logger?.error(messages.firefoxFailedToStart(error))
        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          throw new Error('Firefox failed to start')
        } else {
          process.exit(1)
        }
      }

      // Attach sub-plugin to drive reloads via controller
      new FirefoxDoneReloadPlugin(
        () => (this as any).rdpController,
        this.logger as any
      ).apply(compiler)

      done()
    })

    // When running in dryRun mode, avoid setting up
    // inspection steps that depend on a running browser.
    if (this.dryRun) {
      return
    }

    if (compiler.options.mode === 'development') {
      new SetupFirefoxInspectionStep({
        browser: this.browser,
        mode: compiler.options.mode || 'development',
        source: this.source as string,
        watchSource: this.watchSource,
        startingUrl: this.startingUrl,
        port: this.port,
        instanceId: this.instanceId
      }).apply(compiler)
    }
  }

  private async cleanupInstance(): Promise<void> {
    try {
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM')
        } catch {
          // Ignore
        }

        setTimeout(() => {
          try {
            if (child && !child.killed) child.kill('SIGKILL')
          } catch {
            // Ignore
          }
        }, 2000)
      }
    } catch {
      // Ignore
    }
  }
}
