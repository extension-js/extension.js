import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler} from '@rspack/core'
import {spawn, type ChildProcess} from 'child_process'
import * as chromeLocation from 'chrome-location2'
import edgeLocation from 'edge-location'
import {browserConfig} from './browser-config'
import * as messages from '../browsers-lib/messages'
import {PluginInterface, type PluginRuntime} from '../browsers-types'
import {DevOptions} from '../../../types/options'
import {CDPExtensionController} from './setup-chrome-inspection/cdp-extension-controller'
import {logChromiumDryRun} from './dry-run'
import {setupCdpAfterLaunch} from './setup-cdp-after-launch'
import {setInstancePorts} from '../browsers-lib/instance-registry'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../browsers-lib/shared-utils'
import {setupProcessSignalHandlers} from './process-handlers'

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
  private logger?: ReturnType<Compiler['getInfrastructureLogger']>

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
      this.logger?.info(messages.skippingBrowserLaunchDueToCompileErrors())
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
          this.logger?.error(
            messages.browserNotInstalledError(browser, 'edge binary not found')
          )
          process.exit(1)
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
      this.logger?.error(
        messages.browserNotInstalledError(browser, browserBinaryLocation)
      )
      // Avoid killing the test runner during unit tests
      if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
        throw new Error('Browser not installed or binary path not found')
      } else {
        process.exit(1)
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
      this.logger?.info(
        messages.devChromiumDebugPort(selectedPort, desiredPort)
      )
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
    this.logger?.info(messages.chromeInitializingEnhancedReload())

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

      this.logger?.debug?.(
        '[plugin-browsers] Final Chrome flags:',
        launchArgs.join(' ')
      )

      child.on('close', (code: number | null) => {
        if (process.env.EXTENSION_ENV === 'development') {
          this.logger?.info(messages.chromeProcessExited(code || 0))
        }
      })

      child.on('error', (error) => {
        this.logger?.error(messages.chromeProcessError(error))
      })

      setupProcessSignalHandlers(this.browser, child, () => {})
    } catch (error) {
      this.logger?.error(messages.chromeFailedToSpawn(error))
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
      typeof (compiler as any)?.getInfrastructureLogger === 'function'
        ? (compiler as any).getInfrastructureLogger(RunChromiumPlugin.name)
        : (fallbackLogger() as ReturnType<Compiler['getInfrastructureLogger']>)

    compiler.hooks.done.tapAsync('run-browsers:module', (stats, done) => {
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
        } catch {
          // ignore
        }

        this.logger?.info(messages.skippingBrowserLaunchDueToCompileErrors())
        done()
        return
      }

      if (chromiumDidLaunch) {
        // Subsequent rebuilds: trigger hard reload only if manifest or background changed
        void this.conditionalHardReload(stats)
        done()
        return
      }

      this.launchChromium(stats.compilation, this.browser).then(() => {
        this.logger?.info(
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

  private async conditionalHardReload(stats: unknown): Promise<void> {
    // Accept anything with .compilation.getAssets() matching Rspack's type shape
    try {
      // Do not reload on error builds. Wait until the next successful build
      const hasErrors =
        // @ts-expect-error - stats is unknown
        typeof stats?.hasErrors === 'function'
          ? // @ts-expect-error - stats is unknown
            stats?.hasErrors()
          : // @ts-expect-error - stats is unknown
            !!stats?.compilation?.errors?.length

      if (hasErrors) return

      const s = stats as {
        compilation?: {
          getAssets?: () => Array<{name: string; emitted?: boolean}>
        }
      }
      const comp =
        s?.compilation && typeof s.compilation.getAssets === 'function'
          ? s.compilation
          : undefined

      if (!comp) return

      const getAssets = comp.getAssets as () => Array<{
        name: string
        emitted?: boolean
      }>
      const emitted: string[] = getAssets()
        .filter((a) => (a as {emitted?: boolean})?.emitted)
        .map((a) => (a as {name: string}).name)

      const changedCritical = emitted.some((n: string) =>
        /(^|\/)manifest\.json$|(^|\/)background\/(service_worker|script)\.js$/i.test(
          String(n || '')
        )
      )
      if (changedCritical) {
        const ctrl = this.cdpController

        const retryReload = async () => {
          if (!ctrl) return

          const attempts = 3
          let last: unknown

          for (let i = 0; i < attempts; i++) {
            try {
              await ctrl.hardReload()
              return
            } catch (e) {
              last = e
              await new Promise((r) => setTimeout(r, 150 * (i + 1)))
            }
          }
          throw last
        }
        await retryReload()
      }
    } catch (e) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(
          '[plugin-browsers] CDP conditional hard reload failed:',
          String(e)
        )
      }
    }
  }
}
