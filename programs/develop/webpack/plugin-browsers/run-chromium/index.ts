import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler} from '@rspack/core'
import {spawn, type ChildProcess} from 'child_process'
import * as chromeLocation from 'chrome-location2'
import edgeLocation from 'edge-location'
import {browserConfig} from './browser-config'
import * as messages from '../browsers-lib/messages'
import {PluginInterface, type PluginRuntime} from '../browsers-types'
import {DevOptions} from '../../types/options'
import {CDPExtensionController} from './setup-chrome-inspection/cdp-extension-controller'
import {logChromiumDryRun} from './dry-run'
import {setupCdpAfterLaunch} from './setup-cdp-after-launch'
import {setInstancePorts} from '../browsers-lib/instance-registry'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../browsers-lib/shared-utils'
import {setupProcessSignalHandlers} from './process-handlers'
import {ChromiumWatchRunReloadPlugin} from './watch-run-reload'
import {ChromiumDoneReloadPlugin} from './done-reload'

export class RunChromiumPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags?: string[]
  public readonly excludeBrowserFlags?: string[]
  public readonly profile?: string | false
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string
  public readonly autoReload?: boolean
  public readonly stats?: boolean
  public readonly chromiumBinary?: string
  public readonly port?: string | number
  public readonly instanceId?: string
  public readonly source?: string
  public readonly watchSource?: boolean
  public readonly dryRun?: boolean
  private cdpController?: CDPExtensionController
  // Logger flags
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
  private bannerPrintedOnce?: boolean
  private logger!: ReturnType<Compiler['getInfrastructureLogger']>
  private lastManifestString?: string
  private pendingHardReloadReason?: 'manifest' | 'locales' | 'sw'
  private lastServiceWorkerAbsPath?: string
  private lastServiceWorkerMtimeMs?: number
  private lastServiceWorkerRelPath?: string

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser
    this.browserFlags = options.browserFlags || []
    this.excludeBrowserFlags = options.excludeBrowserFlags || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
    this.chromiumBinary = options.chromiumBinary
    this.port = options.port
    this.instanceId = options.instanceId
    this.source = options.source
    this.watchSource = options.watchSource
    this.dryRun = options.dryRun
    // Logger flags
    this.logLevel = options.logLevel
    this.logContexts = options.logContexts
    this.logFormat = options.logFormat
    this.logTimestamps = options.logTimestamps
    this.logColor = options.logColor
    this.logUrl = options.logUrl
    this.logTab = options.logTab
  }

  private async launchChromium(
    compilation: Compilation,
    browser: DevOptions['browser']
  ) {
    // Extra guard: never launch if compilation has errors
    const compilationErrors = compilation?.errors || []

    if (compilationErrors.length > 0) {
      this.logger.info(messages.skippingBrowserLaunchDueToCompileErrors())
      return
    }

    // In test/dry-run contexts, skip binary detection and spawning
    if (this.dryRun || process.env.VITEST || process.env.VITEST_WORKER_ID) {
      logChromiumDryRun('chromium-mock-binary', [])
      return
    }

    let browserBinaryLocation: string

    switch (browser) {
      case 'chrome':
        browserBinaryLocation = chromeLocation.default()
        break

      case 'edge':
        try {
          browserBinaryLocation = edgeLocation()
        } catch (e) {
          this.logger.error(
            messages.browserNotInstalledError(browser, 'edge binary not found')
          )
          if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
            throw new Error('Chromium launch failed')
          } else {
            process.exit(1)
          }
        }
        break

      case 'chromium-based':
        browserBinaryLocation = path.normalize(this.chromiumBinary!)
        break

      default:
        browserBinaryLocation = chromeLocation.default()
        break
    }

    if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
      this.logger.error(
        messages.browserNotInstalledError(browser, browserBinaryLocation)
      )
      // Avoid killing the test runner during unit tests
      if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
        throw new Error('Browser not installed or binary path not found')
      } else {
        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          throw new Error('Chromium process crashed')
        } else {
          process.exit(1)
        }
      }
    }

    // Determine project/output paths
    // No instance manager; rely on profile locks only
    // Prepare only user extension(s)
    const extensionsToLoad = Array.isArray(this.extension)
      ? [...this.extension]
      : [this.extension]

    const effectiveInstanceId: string | undefined = this.instanceId

    let chromiumConfig: string[]
    try {
      chromiumConfig = browserConfig(compilation, {
        ...this,
        profile: this.profile,
        instanceId: effectiveInstanceId,
        extension: extensionsToLoad,
        logLevel: this.logLevel
      })

      // One-time dev hint when falling back
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(
          messages.profileFallbackWarning(
            this.browser,
            'ephemeral/persistent profile selection handled by config'
          )
        )
      }
    } catch (error) {
      throw error
    }

    // Ensure CDP port availability (always in dev; already added flags)
    const desiredPort = deriveDebugPortWithInstance(this.port, this.instanceId)
    const freePort = await findAvailablePortNear(desiredPort)
    const selectedPort = freePort

    if (freePort !== desiredPort) {
      // Replace port occurrences in flags
      chromiumConfig = chromiumConfig.map((flag) =>
        flag.startsWith('--remote-debugging-port=')
          ? `--remote-debugging-port=${selectedPort}`
          : flag
      )
    }

    if (process.env.EXTENSION_ENV === 'development') {
      this.logger.info(messages.devChromiumDebugPort(selectedPort, desiredPort))
    }

    // Record actual CDP port for this instance for downstream steps
    setInstancePorts(this.instanceId, {cdpPort: selectedPort})

    if (this.dryRun) {
      logChromiumDryRun(browserBinaryLocation, chromiumConfig)
      return
    }

    // Use direct spawn for basic functionality
    await this.launchWithDirectSpawn(browserBinaryLocation, chromiumConfig)

    // After launch, connect CDP and load the extension to get runtime info and logs
    try {
      const cdpConfig: PluginRuntime = {
        extension: Array.isArray(this.extension)
          ? this.extension
          : [this.extension],
        browser: this.browser as
          | 'chrome'
          | 'edge'
          | 'firefox'
          | 'chromium-based',
        port: this.port,
        instanceId: this.instanceId,
        bannerPrintedOnce: this.bannerPrintedOnce,
        logLevel: this.logLevel,
        logContexts: this.logContexts,
        logUrl: this.logUrl,
        logTab: this.logTab,
        logFormat: this.logFormat,
        logTimestamps: this.logTimestamps,
        logColor: this.logColor,
        cdpController: this.cdpController
      }

      await setupCdpAfterLaunch(compilation, cdpConfig, chromiumConfig)

      // Persist controller so subsequent rebuilds can trigger hard reloads
      if (cdpConfig.cdpController) {
        this.cdpController = cdpConfig.cdpController as CDPExtensionController
      }
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(
          '[plugin-browsers] CDP post-launch setup failed:',
          String(error)
        )
      }
    }
  }

  private async launchWithDirectSpawn(
    browserBinaryLocation: string,
    chromeFlags: string[]
  ) {
    this.logger.info(messages.chromeInitializingEnhancedReload())

    // Ensure flags come first so Chrome acknowledges them; URL last
    const launchArgs = this.startingUrl
      ? [...chromeFlags, this.startingUrl]
      : [...chromeFlags]

    // Suppress raw Chromium stdout/stderr to avoid noisy updater logs.
    // Unified logs are streamed via CDP instead.
    const stdio = 'ignore'

    try {
      // Enhanced process management for AI usage
      const child = spawn(`${browserBinaryLocation}`, launchArgs, {
        stdio,
        // Ensure child process terminates when parent exits
        detached: false,
        // Create new process group for better isolation (Unix-like systems)
        ...(process.platform !== 'win32' && {
          group: process.getgid?.()
        })
      })

      this.logger.debug?.(
        '[plugin-browsers] Final Chrome flags:',
        launchArgs.join(' ')
      )

      child.on('close', (code: number | null) => {
        if (process.env.EXTENSION_ENV === 'development') {
          this.logger.info(messages.chromeProcessExited(code || 0))
        }
      })

      child.on('error', (error) => {
        this.logger.error(messages.chromeProcessError(error))
      })

      setupProcessSignalHandlers(this.browser, child, () => {})
    } catch (error) {
      this.logger.error(messages.chromeFailedToSpawn(error))
      throw error
    }
  }

  apply(compiler: Compiler) {
    let chromiumDidLaunch = false

    const fallbackLogger = () => ({
      info: (...a: unknown[]) => console.log(...a),
      warn: (...a: unknown[]) => console.warn(...a),
      error: (...a: unknown[]) => console.error(...a),
      debug: (...a: unknown[]) => console.debug?.(...a)
    })
    this.logger =
      typeof compiler?.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger(RunChromiumPlugin.name)
        : (fallbackLogger() as ReturnType<Compiler['getInfrastructureLogger']>)

    // Attach sub-plugins for hook-specific responsibilities
    new ChromiumWatchRunReloadPlugin({
      logger: this.logger,
      getServiceWorkerPaths: () => ({
        absolutePath: this.lastServiceWorkerAbsPath,
        relativePath: this.lastServiceWorkerRelPath
      }),
      setPendingReason: (r) => {
        this.pendingHardReloadReason = r
      }
    }).apply(compiler)

    new ChromiumDoneReloadPlugin({
      logger: this.logger,
      getExtensionRoot: () =>
        Array.isArray(this.extension)
          ? this.extension.find((e): e is string => typeof e === 'string') || ''
          : (this.extension as string),
      setServiceWorkerPaths: (rel?: string, abs?: string) => {
        this.lastServiceWorkerRelPath = rel
        this.lastServiceWorkerAbsPath = abs
      },
      getPendingReason: () => this.pendingHardReloadReason,
      clearPendingReason: () => {
        this.pendingHardReloadReason = undefined
      },
      getController: () => this.cdpController
    }).apply(compiler)

    compiler.hooks.done.tapAsync('run-browsers:module', (stats, done) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        this.logger.info(messages.skippingBrowserLaunchDueToCompileErrors())
        done()
        return
      }

      if (chromiumDidLaunch) {
        // Refresh SW path from manifest asset to be used by watchRun comparisons
        try {
          const extensionRoot = Array.isArray(this.extension)
            ? this.extension.find((e): e is string => typeof e === 'string') ||
              ''
            : (this.extension as string)

          if (extensionRoot) {
            const assetsObj = stats.compilation.assets as unknown as Record<
              string,
              {source: () => unknown}
            >
            const manifestAsset = assetsObj['manifest.json']
            const manifestStr = manifestAsset
              ? String(manifestAsset.source())
              : ''

            if (manifestStr) {
              try {
                const parsed = JSON.parse(manifestStr)
                const serviceWorker: unknown =
                  parsed?.background?.service_worker

                if (typeof serviceWorker === 'string' && serviceWorker) {
                  this.lastServiceWorkerRelPath = serviceWorker
                  this.lastServiceWorkerAbsPath = path.join(
                    extensionRoot,
                    serviceWorker
                  )
                }
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // ignore
        }

        done()
        return
      }

      this.launchChromium(stats.compilation, this.browser).then(() => {
        this.logger.info(
          messages.stdoutData(
            this.browser,
            stats.compilation.options.mode as 'development' | 'production'
          )
        )
      })

      chromiumDidLaunch = true
      done()
    })
  }
}
