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
  private logger!: ReturnType<Compiler['getInfrastructureLogger']>
  private lastManifestString?: string
  private pendingHardReloadReason?: 'manifest' | 'locales' | 'sw'
  private lastServiceWorkerAbsPath?: string
  private lastServiceWorkerMtimeMs?: number

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

    // Detect manifest/locales/SW changes as early as possible (source files)
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

          let hitServiceWorker = false

          if (this.lastServiceWorkerAbsPath) {
            const absoluteFilePath = this.lastServiceWorkerAbsPath.replace(/\\/g, '/')
            hitServiceWorker = normalizedFilePaths.some(
              (filePath) => filePath === absoluteFilePath || filePath.endsWith(absoluteFilePath)
            )
          }

          if (hitManifest) this.pendingHardReloadReason = 'manifest'
          else if (hitLocales) this.pendingHardReloadReason = 'locales'
          else if (hitServiceWorker) this.pendingHardReloadReason = 'sw'
        } catch (error) {
          this.logger.warn?.('[reload-debug] watchRun inspect failed:', String(error))
        }
        done()
      }
    )

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
        // Refresh SW absolute path and detect change via mtime
        try {
          const extensionRoot = Array.isArray(this.extension)
            ? (this.extension.find((e): e is string => typeof e === 'string') || '')
            : (this.extension as string)

          if (extensionRoot) {
            const manifestPath = path.join(extensionRoot, 'manifest.json')

            if (fs.existsSync(manifestPath)) {
              const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
              const serviceWorker = parsed.background?.service_worker

              if (typeof serviceWorker === 'string' && serviceWorker) {
                const serviceWorkerAbs = path.join(extensionRoot, serviceWorker)
                this.lastServiceWorkerAbsPath = serviceWorkerAbs

                try {
                  const serviceWorkerStat = fs.statSync(serviceWorkerAbs)
                  const mtime = Math.floor(serviceWorkerStat.mtimeMs)

                  if (
                    typeof this.lastServiceWorkerMtimeMs === 'number' &&
                    mtime !== this.lastServiceWorkerMtimeMs
                  ) {
                    this.pendingHardReloadReason = 'sw'
                  }
                  this.lastServiceWorkerMtimeMs = mtime
                } catch {
                  // ignore
                }
              }
            }
          }
        } catch {
          // ignore
        }

        const noErr =
          typeof stats?.hasErrors === 'function'
            ? !stats.hasErrors()
            : !stats?.compilation?.errors?.length

        if (noErr && this.pendingHardReloadReason) {
          const reason = this.pendingHardReloadReason
          this.pendingHardReloadReason = undefined

          const ctrl = this.cdpController

          const tryReload = async () => {
            if (!ctrl) {
              this.logger.warn?.('[reload] controller not ready; skipping reload')
              return
            }

            this.logger.info?.(`[reload] reloading extension (reason:${reason})`)
            await ctrl.hardReload()
          }

          tryReload()
          done()
          return
        }

        // Fallback
        this.conditionalHardReload(stats)
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

      const emitted: string[] = (stats as {compilation: Compilation}).compilation
        .getAssets()
        .filter((asset: any) => asset?.emitted)
        .map((asset) => asset.name.replace(/\\/g, '/'))

      this.logger.info('[reload-debug] chromium emitted assets:', emitted)

      // Use the same pattern as feature-manifest: read from compilation.assets
      const assetsObj = (stats as {compilation: Compilation}).compilation.assets as unknown as Record<
        string,
        {source: () => unknown}
      >
      const manifestAsset = assetsObj['manifest.json']
      const manifestStr = manifestAsset ? String(manifestAsset.source()) : ''

      let serviceWorker: string | undefined
      if (manifestStr) {
        try {
          const manifest = JSON.parse(manifestStr)
          if (
            manifest &&
            manifest.background &&
            typeof manifest.background.service_worker === 'string'
          ) {
            serviceWorker = String(manifest.background.service_worker)
          }
        } catch (e) {
          this.logger.warn('[reload-debug] manifest parse failed:', String(e))
        }
      }

      // Detect manifest change robustly by comparing asset content
      let changedByManifestContent = false
      if (manifestStr) {
        changedByManifestContent = this.lastManifestString !== manifestStr
        this.lastManifestString = manifestStr
      }

      const isManifestChanged =
        emitted.includes('manifest.json') || changedByManifestContent
      const isLocalesChanged = emitted.some((n) =>
        /(^|\/)__?locales\/.+\.json$/i.test(n)
      )
      const isServiceWorkerChanged = !!(
        serviceWorker && emitted.includes(serviceWorker.replace(/\\/g, '/'))
      )

      const changedCritical =
        isManifestChanged || isLocalesChanged || isServiceWorkerChanged

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
