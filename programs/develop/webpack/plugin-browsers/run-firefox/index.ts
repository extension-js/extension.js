import {spawn, ChildProcess} from 'child_process'
import {type Compilation, type Compiler} from '@rspack/core'
import {browserConfig} from './firefox/browser-config'
import {setupFirefoxProcessHandlers} from './process-handlers'
import {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {FirefoxBinaryDetector} from './firefox/binary-detector'
import * as messages from '../browsers-lib/messages'
import {type PluginInterface} from '../browsers-types'
import {BrowserConfig, DevOptions} from '../../../types/options'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../browsers-lib/shared-utils'
import {logFirefoxDryRun} from './dry-run'

let child: ChildProcess | null = null

export class RunFirefoxPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags?: string[]
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
  private logLevel?:
    | 'off'
    | 'error'
    | 'warn'
    | 'info'
    | 'debug'
    | 'trace'
    | 'all'
  private logContexts?: Array<
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  >
  private logFormat?: 'pretty' | 'json' | 'ndjson'
  private logTimestamps?: boolean
  private logColor?: boolean
  private logUrl?: string
  private logTab?: number | string

  private remoteFirefox?: unknown | null
  private logger?: ReturnType<Compiler['getInfrastructureLogger']>
  private pendingHardReloadReason?: 'manifest' | 'locales' // removed 'sw'
  // removed lastServiceWorkerRelPath

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser || 'firefox'
    this.browserFlags = options.browserFlags || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
    this.geckoBinary = options.geckoBinary
    this.port = parseInt(options.port as string, 10)
    this.instanceId = options.instanceId
    this.keepProfileChanges = (options as any)?.keepProfileChanges
    this.copyFromProfile = (options as any)?.copyFromProfile
    this.source = options.source
    this.watchSource = options.watchSource
    ;(this.dryRun as boolean | undefined) = options.dryRun

    // Quiet constructor: avoid noisy logs in normal runs
    // Capture unified logging flags if provided
    this.logLevel = options.logLevel
    this.logContexts = options.logContexts
    this.logFormat = options.logFormat
    this.logTimestamps = options.logTimestamps
    this.logColor = options.logColor
    this.logUrl = options.logUrl
    this.logTab = options.logTab
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

    // Detect Firefox binary with enhanced detection
    let browserBinaryLocation: string
    try {
      browserBinaryLocation = await FirefoxBinaryDetector.detectFirefoxBinary(
        this.geckoBinary
      )
      await FirefoxBinaryDetector.validateFirefoxBinary(browserBinaryLocation)
    } catch (error) {
      this.logger?.error(messages.firefoxDetectionFailed(error))
      process.exit(1)
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

  apply(compiler: Compiler) {
    let firefoxDidLaunch = false
    this.remoteFirefox = this.remoteFirefox || null

    const logger =
      typeof (compiler as any)?.getInfrastructureLogger === 'function'
        ? (compiler as any).getInfrastructureLogger(RunFirefoxPlugin.name)
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => console.debug?.(...a)
          } as ReturnType<Compiler['getInfrastructureLogger']>)

    this.logger = logger

    // Detect manifest/locales changes as early as possible (source files)
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
        const hasErr =
          typeof stats?.hasErrors === 'function'
            ? stats.hasErrors()
            : !!stats?.compilation?.errors?.length

        if (!hasErr && this.pendingHardReloadReason) {
          const reason = this.pendingHardReloadReason
          this.pendingHardReloadReason = undefined

          try {
            const compilation = stats?.compilation
            const assetsArr: Array<{name: string; emitted?: boolean}> =
              Array.isArray(compilation?.getAssets?.())
                ? (compilation!.getAssets() as any)
                : []

            const emitted = assetsArr
              .filter((a) => (a as any)?.emitted)
              .map((a) => String((a as any)?.name || ''))

            const controller = (this as any).rdpController as
              | {hardReload: (c: any, a: string[]) => Promise<void>}
              | undefined

            if (controller) {
              this.logger?.info?.(
                `[reload] reloading extension (reason:${reason})`
              )
              await controller.hardReload(stats.compilation, emitted)
            } else {
              this.logger?.warn?.(
                '[reload] controller not ready; skipping reload'
              )
            }
          } catch (error) {
            this.logger?.warn?.('[reload] reload failed:', String(error))
          }
          done()
          return
        }

        try {
          const comp = stats?.compilation
          const assetsArr: Array<{name: string; emitted?: boolean}> =
            Array.isArray(comp?.getAssets?.())
              ? (comp!.getAssets() as unknown as Array<{
                  name: string
                  emitted?: boolean
                }>)
              : []
          const emitted = assetsArr
            .filter((a) => (a as any)?.emitted)
            .map((a) => a.name)

          const changed = (emitted || []) as string[]
          const controller = (this as any).rdpController as
            | {hardReload: (c: any, a: string[]) => Promise<void>}
            | undefined
          if (controller) {
            await controller.hardReload(stats.compilation, changed)
          }
        } catch {
          // Ignore
        }
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

      done()
    })
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
