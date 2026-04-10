// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import type {CompilationLike, BrowserLogger} from '../../browsers-types'
import locateChrome, {
  getChromeVersion,
  getInstallGuidance as getChromeInstallGuidance
} from 'chrome-location2'
import locateChromium, {
  getChromiumVersion,
  getInstallGuidance as getChromiumInstallGuidance
} from 'chromium-location'
import locateEdge, {
  getEdgeVersion,
  getInstallGuidance as getEdgeInstallGuidance
} from 'edge-location'
import * as messages from '../../browsers-lib/messages'
import * as instanceRegistry from '../../browsers-lib/instance-registry'
import * as binariesResolver from '../../browsers-lib/output-binaries-resolver'
import * as utils from '../../browsers-lib/shared-utils'
import {
  printDevBannerOnce,
  printProdBannerOnce
} from '../../browsers-lib/banner'
import {
  pickSharedBrowserRuntimeOptions,
  publishUserExtensionRoot,
  toExtensionLoadList
} from '../../browsers-lib/runtime-options'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import {browserConfig} from './browser-config'
import {setupProcessSignalHandlers} from './process-handlers'
import {logChromiumDryRun} from './dry-run'
import {getExtensionOutputPath} from './extension-output-path'
import {waitForStableManifest} from '../manifest-readiness'
import {
  isWslEnv,
  normalizeBinaryPathForWsl,
  resolveWslWindowsBinary,
  spawnChromiumProcess
} from './wsl-support'
import type {ChromiumContext} from '../chromium-context'
import type {
  ChromiumLaunchOptions,
  ChromiumPluginRuntime
} from '../chromium-types'
import type {CDPExtensionController} from '../chromium-source-inspection/cdp-extension-controller'
import {checkChromeRemoteDebugging} from '../chromium-source-inspection/discovery'

async function maybePrintDevBanner(args: {
  compilation: CompilationLike
  chromiumConfig: string[]
  browser: ChromiumLaunchOptions['browser']
  hostPort: {host: string; port: number}
  browserVersionLine?: string
  enableCdp: boolean
}) {
  const mode = (args.compilation?.options?.mode || 'development') as string
  if (mode !== 'development') return
  const loadExtensionFlag = args.chromiumConfig.find((flag: string) =>
    flag.startsWith('--load-extension=')
  )
  const extensionOutputPath = getExtensionOutputPath(
    args.compilation,
    loadExtensionFlag
  )
  if (!extensionOutputPath) return
  const ready = await waitForStableManifest(extensionOutputPath, {
    timeoutMs: 10000
  })
  if (!ready) return
  if (args.enableCdp) return
  await printDevBannerOnce({
    browser: args.browser,
    outPath: extensionOutputPath,
    hostPort: args.hostPort,
    getInfo: async () => null,
    browserVersionLine: args.browserVersionLine
  })
}

/**
 * ChromiumLaunchPlugin
 *
 * Intended responsibilities (will be wired incrementally without changing inner logic):
 * - Resolve binary; compose flags (profiles, excludes, overrides)
 * - Allocate CDP port; spawn process; setup signals; dry-run
 * - Connect CDP; ensure extension loaded; print dev banner
 * - Publish controller + port via ChromiumContext
 */
export class ChromiumLaunchPlugin {
  private didLaunch = false
  private didReportReady = false
  private logger!: BrowserLogger

  constructor(
    private readonly options: ChromiumLaunchOptions,
    private readonly ctx: ChromiumContext
  ) {}

  /**
   * Run the Chromium launch flow without requiring a bundler compiler instance.
   * Intended for run-only preview paths.
   */
  public async runOnce(
    compilation: CompilationLike,
    opts?: {enableCdpPostLaunch?: boolean}
  ): Promise<void> {
    // Ensure we have a logger even without a compiler.
    if (!this.logger) {
      this.logger = {
        info: (...a: unknown[]) => console.log(...a),
        warn: (...a: unknown[]) => console.warn(...a),
        error: (...a: unknown[]) => console.error(...a),
        debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
      } as BrowserLogger
    }
    await this.launchChromium(compilation, opts)
  }

  apply(compiler: any) {
    this.logger =
      typeof compiler?.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger('ChromiumLaunchPlugin')
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
          } as BrowserLogger)

    compiler.hooks.done.tapPromise('chromium:launch', async (stats: any) => {
      try {
        const hasErrors =
          typeof stats?.hasErrors === 'function'
            ? stats.hasErrors()
            : !!stats?.compilation?.errors?.length

        if (hasErrors) {
          this.logger.info(messages.skippingBrowserLaunchDueToCompileErrors())
          return
        }

        if (this.didLaunch) {
          return
        }

        await this.launchChromium(stats.compilation)
        this.didLaunch = true
        if (!this.didReportReady) {
          // Use console.log so the message is always visible; infrastructureLogging
          // level is 'error' by default, which would suppress logger.info()
          console.log(
            devServerReady(
              stats.compilation.options.mode as 'development' | 'production',
              this.options.browser
            )
          )
        }
      } catch (error) {
        // Do not swallow: otherwise users can get stuck at "compiled successfully"
        // with no feedback when the browser fails to launch (common in WSL/CI).
        try {
          this.logger.error(
            messages.browserLaunchError(this.options.browser as any, error)
          )
        } catch {
          // ignore
        }
      }
    })
  }

  private async launchChromium(
    compilation: CompilationLike,
    opts?: {enableCdpPostLaunch?: boolean}
  ) {
    // Dry-run short-circuit
    if (
      this.options?.dryRun ||
      process.env.VITEST ||
      process.env.VITEST_WORKER_ID
    ) {
      logChromiumDryRun('chromium-mock-binary', [])
      return
    }

    const browser: string = this.options?.browser

    // Resolve binary (prefer output-resolved, then location helpers)
    let browserBinaryLocation: string | null = null
    let printedGuidance = false
    const normalizePath = (p: string | null): string | null => {
      if (!p) return null
      const normalized = normalizeBinaryPathForWsl(p)
      return normalized || null
    }
    const isUsableBinary = (p: string | null): p is string =>
      Boolean(p && fs.existsSync(p))
    const resolveManagedBinary = (): string | null => {
      try {
        const resolved = binariesResolver.resolveFromBinaries(
          compilation,
          browser === 'chromium' || browser === 'chromium-based'
            ? 'chromium'
            : browser === 'edge'
              ? 'edge'
              : 'chrome'
        )
        const normalized = normalizePath(resolved || null)
        return isUsableBinary(normalized) ? normalized : null
      } catch {
        return null
      }
    }
    const resolveWslFallback = (): string | null =>
      resolveWslWindowsBinary(browser)
    const getInstallGuidanceText = (
      target: 'chrome' | 'chromium' | 'edge'
    ): string => {
      try {
        if (target === 'edge') {
          return getEdgeInstallGuidance()
        }
        if (target === 'chromium') {
          return getChromiumInstallGuidance()
        }
        return getChromeInstallGuidance()
      } catch {
        return `npx extension install ${target}`
      }
    }
    const printInstallGuidance = (
      raw: string,
      browserName: ChromiumLaunchOptions['browser'] | 'edge' | 'chromium'
    ) => {
      this.printEnhancedPuppeteerInstallHint(compilation, raw, browserName)
      printedGuidance = true
    }

    browserBinaryLocation = resolveManagedBinary()

    let skipDetection = Boolean(browserBinaryLocation)
    if (!browserBinaryLocation && isWslEnv()) {
      const wslFallback = resolveWslFallback()
      if (wslFallback) {
        browserBinaryLocation = wslFallback
        skipDetection = true
      }
    }

    const getBrowserVersionLine = (bin: string): string => {
      try {
        if (browser === 'edge') {
          return getEdgeVersion(bin) || ''
        }
        if (browser === 'chromium' || browser === 'chromium-based') {
          return getChromiumVersion(bin) || ''
        }
        return getChromeVersion(bin) || ''
      } catch {
        return ''
      }
    }

    const looksOfficialChromeBinaryPath = (bin: string): boolean => {
      const p = String(bin || '')
      if (!p) return false
      // macOS system Chrome install
      if (
        /\/Applications\/Google Chrome(?: (?:Beta|Dev|Canary))?\.app\/Contents\/MacOS\/Google Chrome/i.test(
          p
        )
      ) {
        return true
      }
      // Windows system Chrome install
      if (/\\Google\\Chrome\\Application\\chrome\.exe$/i.test(p)) return true
      // Linux system Chrome install (typical)
      if (/\/opt\/google\/chrome\//i.test(p)) return true
      if (/\/google-chrome(?:-stable)?$/i.test(p)) return true
      return false
    }

    const managedCacheRoot =
      binariesResolver.computeBinariesBaseDir(compilation)
    const managedEnvFor = (b: ChromiumLaunchOptions['browser']) => ({
      ...process.env,
      ...binariesResolver.managedBrowserCacheEnv(String(managedCacheRoot), b)
    })

    const isAuthorMode = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const resolveChromeLikeBinary = (): string | null => {
      try {
        try {
          const env = managedEnvFor('chrome')
          const located = locateChrome(true, {env}) || null
          if (!located) throw new Error(getInstallGuidanceText('chrome'))
          const normalized = normalizePath(located || null)
          if (isUsableBinary(normalized)) {
            if (looksOfficialChromeBinaryPath(normalized) && !isWslEnv()) {
              printInstallGuidance(
                getInstallGuidanceText('chrome'),
                browser as any
              )
              return null
            }
            return normalized
          }
          return null
        } catch (err) {
          const env = managedEnvFor('chrome')
          let candidate: string | null = locateChrome(true, {env}) || null
          const normalized = normalizePath(candidate || null)
          if (normalized) {
            if (looksOfficialChromeBinaryPath(normalized) && !isWslEnv()) {
              printInstallGuidance(
                getInstallGuidanceText('chrome'),
                browser as any
              )
              candidate = null
            }
          }
          const resolved = normalizePath(candidate || null)
          const fallback = resolved || resolveWslFallback()
          if (!fallback) throw err
          return fallback
        }
      } catch (error) {
        printInstallGuidance(String(error), browser as any)
        return null
      }
    }

    switch (browser) {
      case 'chrome': {
        if (isAuthorMode) console.log(messages.locatingBrowser(browser))

        if (!skipDetection) {
          browserBinaryLocation = resolveChromeLikeBinary()
        }
        break
      }

      case 'chromium': {
        if (isAuthorMode) console.log(messages.locatingBrowser(browser))

        // Prefer explicit binary when provided
        browserBinaryLocation = this.options?.chromiumBinary || null
        // If user provided a binary, require it to exist
        if (this.options?.chromiumBinary) {
          const normalized = normalizePath(String(this.options.chromiumBinary))
          if (!normalized || !fs.existsSync(normalized)) {
            console.error(
              messages.invalidChromiumBinaryPath(
                String(this.options.chromiumBinary)
              )
            )
            process.exit(1)
          }
          browserBinaryLocation = normalized
        }

        if (!browserBinaryLocation && !skipDetection) {
          try {
            const env = managedEnvFor('chromium')
            const p = locateChromium({env})
            const normalized = normalizePath(p || null)
            if (normalized && typeof normalized === 'string') {
              if (fs.existsSync(normalized)) browserBinaryLocation = normalized
            }
          } catch {
            // ignore; not fatal here
          }
        }
        if (!browserBinaryLocation) {
          browserBinaryLocation = resolveWslFallback()
        }
        break
      }

      case 'edge': {
        if (isAuthorMode) console.log(messages.locatingBrowser(browser))

        try {
          // Honor explicit env override first
          const override = String(process.env.EDGE_BINARY || '').trim()
          if (override) {
            const normalized = normalizePath(override)
            if (normalized && fs.existsSync(normalized)) {
              browserBinaryLocation = normalized
            } else {
              throw new Error('EDGE_BINARY points to a non-existent path')
            }
          } else {
            const env = managedEnvFor('edge')
            const located = locateEdge({env})
            const normalized = normalizePath(located || null)
            browserBinaryLocation = normalized
            // Validate detected path. If not found, show install guidance just like the catch block.
            if (
              !browserBinaryLocation ||
              !fs.existsSync(String(browserBinaryLocation))
            ) {
              const fallback = resolveWslWindowsBinary(browser)
              if (fallback) {
                browserBinaryLocation = fallback
                break
              }
              const guidance = getInstallGuidanceText('edge')

              printInstallGuidance(guidance, 'edge')
              browserBinaryLocation = null

              if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
                throw new Error('Chromium launch failed')
              } else {
                process.exit(1)
              }
            }
          }
        } catch {
          const guidance = getInstallGuidanceText('edge')

          const fallback = resolveWslFallback()
          if (fallback) {
            browserBinaryLocation = fallback
          } else {
            printInstallGuidance(guidance, 'edge')
            browserBinaryLocation = null
          }

          if (!browserBinaryLocation) {
            if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
              throw new Error('Chromium launch failed')
            } else {
              process.exit(1)
            }
          }
        }
        break
      }

      case 'chromium-based': {
        // Prefer explicit binary; otherwise try chromium-location
        browserBinaryLocation = this.options?.chromiumBinary || null
        // Engine-based requires explicit working binary path
        if (this.options?.chromiumBinary) {
          const normalized = normalizePath(String(this.options.chromiumBinary))
          if (!normalized || !fs.existsSync(normalized)) {
            console.error(
              messages.invalidChromiumBinaryPath(
                String(this.options.chromiumBinary)
              )
            )
            process.exit(1)
          }
          browserBinaryLocation = normalized
        } else {
          console.error(messages.requireChromiumBinaryForChromiumBased())
          process.exit(1)
        }
        if (!browserBinaryLocation && !skipDetection) {
          try {
            const env = managedEnvFor('chromium')
            const p = locateChromium({env})
            const normalized = normalizePath(p || null)
            if (normalized && typeof normalized === 'string') {
              if (fs.existsSync(normalized)) browserBinaryLocation = normalized
            }
          } catch {
            // ignore
          }
        }
        if (!browserBinaryLocation) {
          browserBinaryLocation = resolveWslFallback()
        }
        break
      }

      default: {
        browserBinaryLocation = resolveChromeLikeBinary()
        break
      }
    }

    if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
      browserBinaryLocation = browserBinaryLocation || resolveManagedBinary()

      if (!browserBinaryLocation) {
        browserBinaryLocation = resolveWslFallback()
      }

      if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
        // Always print pretty guidance for Chromium flavors
        if (browser === 'chromium' || browser === 'chromium-based') {
          printInstallGuidance(getInstallGuidanceText('chromium'), 'chromium')
        }

        if (
          !printedGuidance &&
          browser !== 'chromium' &&
          browser !== 'chromium-based'
        ) {
          this.logger.error(
            messages.browserNotInstalledError(
              browser as any,
              browserBinaryLocation || ''
            )
          )
        }

        if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
          throw new Error('Browser not installed or binary path not found')
        } else {
          process.exit(1)
        }
      }
    }

    const extensionsToLoad = toExtensionLoadList(this.options.extension)
    publishUserExtensionRoot(extensionsToLoad, this.ctx.setExtensionRoot)

    let chromiumConfig: string[] = browserConfig(compilation, {
      ...this.options,
      profile: this.options.profile,
      instanceId: this.options.instanceId,
      extension: extensionsToLoad,
      logLevel: this.options.logLevel
    })

    const desiredPort = utils.deriveDebugPortWithInstance(
      this.options.port,
      this.options.instanceId
    )
    const freePort = await utils.findAvailablePortNear(desiredPort)

    const selectedPort = freePort

    if (freePort !== desiredPort) {
      chromiumConfig = chromiumConfig.map((flag) =>
        flag.startsWith('--remote-debugging-port=')
          ? `--remote-debugging-port=${selectedPort}`
          : flag
      )
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      this.logger.info(messages.devChromiumDebugPort(selectedPort, desiredPort))
    }
    instanceRegistry.setInstancePorts(this.options.instanceId, {
      cdpPort: selectedPort
    })

    const enableCdp = opts?.enableCdpPostLaunch === false ? false : true
    await maybePrintDevBanner({
      compilation,
      chromiumConfig,
      browser: this.options.browser,
      hostPort: {host: '127.0.0.1', port: selectedPort},
      enableCdp
    })

    if (this.options.dryRun) {
      logChromiumDryRun(browserBinaryLocation, chromiumConfig)
      return
    }

    await this.launchWithDirectSpawn(browserBinaryLocation, chromiumConfig)

    // Verify the debug port is actually bound before proceeding
    if (enableCdp) {
      let portReady = false
      for (let attempt = 0; attempt < 10; attempt++) {
        portReady = await checkChromeRemoteDebugging(selectedPort)
        if (portReady) break
        await new Promise((r) => setTimeout(r, 500))
      }
      if (!portReady && process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.logger.warn?.(
          `[browser] Debug port ${selectedPort} not bound after spawn — CDP may fail`
        )
      }
    }

    if (compilation.options.mode === 'development' && !this.didReportReady) {
      // Use console.log so the message is always visible; infrastructureLogging
      // level is 'error' by default, which would suppress logger.info()
      console.log(
        devServerReady(
          compilation.options.mode as 'development' | 'production',
          this.options.browser
        )
      )
      this.didReportReady = true
    }

    try {
      // Best-effort: derive a human-readable browser version line for dev/prod banners.
      let browserVersionLine: string | undefined

      try {
        if (browserBinaryLocation && fs.existsSync(browserBinaryLocation)) {
          const vLine = getBrowserVersionLine(browserBinaryLocation)
          if (vLine && vLine.trim().length > 0) {
            browserVersionLine = vLine.trim()
          }
        }
      } catch {
        // ignore – banner will fall back to generic browser label
      }

      const mode = (compilation?.options?.mode || 'development') as string

      // Always print a manifest-based production summary once,
      // even if CDP fails later. CDP will attempt to "upgrade" this when it succeeds.
      try {
        if (mode === 'production') {
          const loadExtensionFlag = chromiumConfig.find((flag: string) =>
            flag.startsWith('--load-extension=')
          )
          const extensionOutputPath = getExtensionOutputPath(
            compilation,
            loadExtensionFlag
          )

          if (extensionOutputPath) {
            await printProdBannerOnce({
              browser: this.options.browser,
              outPath: extensionOutputPath,
              browserVersionLine
            })
          }
        }
      } catch {
        // best-effort only; ignore banner errors
      }

      const cdpConfig: ChromiumPluginRuntime = {
        ...pickSharedBrowserRuntimeOptions({
          ...this.options,
          extension: extensionsToLoad
        }),
        chromiumBinary: this.options.chromiumBinary,
        bannerPrintedOnce: false,
        cdpController: undefined,
        browserVersionLine
      }

      // Optional CDP wiring (dev + inspection). Run-only preview disables this
      // to avoid pulling in WS/CDP dependencies.
      if (enableCdp) {
        const mod = await import('./setup-cdp-after-launch')
        await mod.setupCdpAfterLaunch(compilation, cdpConfig, chromiumConfig)

        if (cdpConfig.cdpController) {
          this.ctx.setController(
            cdpConfig.cdpController as CDPExtensionController,
            selectedPort
          )
        }
      }
    } catch (error) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn('[browser] CDP post-launch setup failed:', String(error))
      }
    }
  }

  private async launchWithDirectSpawn(binary: string, chromeFlags: string[]) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      this.logger.info(messages.chromeInitializingEnhancedReload())
    }
    const launchArgs = this.options?.startingUrl
      ? [...chromeFlags, this.options.startingUrl]
      : [...chromeFlags]
    const stdio = 'ignore'
    const normalizedBinary = normalizeBinaryPathForWsl(binary)

    try {
      const child = await spawnChromiumProcess({
        binary: normalizedBinary,
        launchArgs,
        stdio,
        browser: this.options.browser,
        logger: this.logger
      })

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.logger.debug?.(
          '[browser] Final Chrome flags:',
          launchArgs.join(' ')
        )
      }

      child.on('close', (code: number | null) => {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.logger.info(messages.chromeProcessExited(code || 0))
        }
      })

      child.on('error', (error) => {
        this.logger.error(messages.chromeProcessError(error))
      })

      setupProcessSignalHandlers(this.options?.browser, child, () => {})
    } catch (error) {
      this.logger.error(messages.chromeFailedToSpawn(error))
      throw error
    }
  }

  private printEnhancedPuppeteerInstallHint(
    compilation: CompilationLike,
    raw: string,
    browserName?: string
  ) {
    try {
      const displayCacheDir =
        binariesResolver.computeBinariesBaseDir(compilation)
      const pretty = messages.prettyPuppeteerInstallGuidance(
        (browserName as any) || (this.options?.browser as any),
        raw,
        displayCacheDir
      )
      console.error(pretty)
    } catch {
      try {
        const pretty = messages.prettyPuppeteerInstallGuidance(
          (browserName as any) || (this.options?.browser as any),
          raw,
          ''
        )
        console.error(pretty)
      } catch {
        console.error(raw)
      }
    }
  }
}
