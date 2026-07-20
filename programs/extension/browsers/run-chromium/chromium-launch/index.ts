// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import locateBrave from 'brave-location'
import locateChrome, {
  getInstallGuidance as getChromeInstallGuidance,
  getChromeVersion
} from 'chrome-location2'
import locateChromium, {
  getInstallGuidance as getChromiumInstallGuidance,
  getChromiumVersion
} from 'chromium-location'
import locateEdge, {
  getInstallGuidance as getEdgeInstallGuidance,
  getEdgeVersion
} from 'edge-location'
import locateOpera from 'opera-location2'
import locateVivaldi from 'vivaldi-location2'
import locateYandex from 'yandex-location'
import {
  printDevBannerOnce,
  printProdBannerOnce
} from '../../browsers-lib/banner'
import * as instanceRegistry from '../../browsers-lib/instance-registry'
import {
  diagnoseChromiumManifestRefusal,
  findChromiumLoadBlockers,
  findInvalidMatchPatterns,
  findLocaleLoadBlockers,
  findMissingManagedSchema,
  findUnloadableIconFiles
} from '../../browsers-lib/manifest-refusal'
import * as messages from '../../browsers-lib/messages'
import * as binariesResolver from '../../browsers-lib/output-binaries-resolver'
import {wasTerminatedByUs} from '../../browsers-lib/process-teardown'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import {
  pickSharedBrowserRuntimeOptions,
  toExtensionLoadList
} from '../../browsers-lib/runtime-options'
import * as utils from '../../browsers-lib/shared-utils'
import type {
  BrowserLogger,
  BrowserType,
  CompilationLike
} from '../../browsers-types'
import type {CDPExtensionController} from '../cdp/cdp-extension-controller'
import {checkChromeRemoteDebugging} from '../cdp/discovery'
import type {ChromiumContext} from '../chromium-context'
import type {
  ChromiumLaunchOptions,
  ChromiumPluginRuntime
} from '../chromium-types'
import {waitForStableManifest} from '../manifest-readiness'
import {browserConfig} from './browser-config'
import {logChromiumDryRun} from './dry-run'
import {getExtensionOutputPath} from './extension-output-path'
import {setupProcessSignalHandlers} from './process-handlers'
import {
  isWslEnv,
  normalizeBinaryPathForWsl,
  preferRealChromeBinary,
  resolveWslLinuxBinary,
  resolveWslWindowsBinary,
  spawnChromiumProcess
} from './wsl-support'

// Shape of the stats value the injected compiler hands to the done hook;
// tolerates both real rspack Stats and the mock compilers specs pass.
interface LaunchDoneStats {
  hasErrors?: () => boolean
  compilation: CompilationLike & {
    options: {mode?: string}
    errors?: unknown[]
  }
}

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

// Shared with the Firefox launcher; re-exported here for existing importers.
import {stampReadyBrowserExited} from '../../browsers-lib/ready-stamp'
export {stampReadyBrowserExited}

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
  // Set right before spawn so the child 'close' handler (which has no
  // compilation in scope) can tell a dev session apart and find ready.json.
  private closeHandlerContext: {
    isDevMode: boolean
    extensionOutputPath?: string
  } | null = null

  constructor(
    private readonly options: ChromiumLaunchOptions,
    private readonly ctx: ChromiumContext
  ) {}

  // Run the Chromium launch flow without a bundler compiler instance;
  // intended for run-only preview paths.
  public async runOnce(
    compilation: CompilationLike,
    opts?: {enableCdpPostLaunch?: boolean}
  ): Promise<void> {
    if (!this.logger) {
      this.logger = {
        info: (...a: unknown[]) => console.log(...a),
        warn: (...a: unknown[]) => console.warn(...a),
        error: (...a: unknown[]) => console.error(...a),
        debug: (...a: unknown[]) => console.debug?.(...a)
      } as BrowserLogger
    }
    await this.launchChromium(compilation, opts)
  }

  apply(compiler: unknown) {
    const host = compiler as {
      getInfrastructureLogger?: (name: string) => BrowserLogger
      hooks: {
        done: {
          tapPromise: (
            name: string,
            cb: (stats: LaunchDoneStats) => Promise<void>
          ) => void
        }
      }
    }
    this.logger =
      typeof host?.getInfrastructureLogger === 'function'
        ? host.getInfrastructureLogger('ChromiumLaunchPlugin')
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => console.debug?.(...a)
          } as BrowserLogger)

    host.hooks.done.tapPromise('chromium:launch', async (stats) => {
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
            messages.browserLaunchError(this.options.browser, error)
          )
        } catch {}
      }
    })
  }

  private async launchChromium(
    compilation: CompilationLike,
    opts?: {enableCdpPostLaunch?: boolean}
  ) {
    if (
      this.options?.dryRun ||
      process.env.VITEST ||
      process.env.VITEST_WORKER_ID
    ) {
      logChromiumDryRun('chromium-mock-binary', [])
      return
    }

    const browser = this.options?.browser

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
          return getEdgeInstallGuidance({
            steps: [
              {
                summary: 'Install Edge into the managed browser cache',
                command: 'npx extension install edge'
              }
            ]
          })
        }
        if (target === 'chromium') {
          // Chrome for Testing first: it tracks the stable channel Chrome users run,
          // and the chromium-family launch fallback picks it up automatically.
          return getChromiumInstallGuidance({
            steps: [
              {
                summary:
                  'Install Chrome for Testing (recommended, stable channel; chromium targets use it automatically)',
                command: 'npx extension install chrome'
              },
              {
                summary: 'Install Chromium (unbranded snapshot build)',
                command: 'npx extension install chromium'
              }
            ]
          })
        }
        return getChromeInstallGuidance({
          steps: [
            {
              summary:
                'Install Chrome for Testing into the managed browser cache (stable channel)',
              command: 'npx extension install chrome'
            }
          ]
        })
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

    // Managed chromium installs are tip-of-tree snapshots (dev channel); swap to
    // the system stable binary when present unless the user opts into the snapshot.
    if (browser === 'chromium' && browserBinaryLocation) {
      let systemBinary: string | null = null
      try {
        // System scan only: drop the managed-cache env so the cache can't
        // answer for itself, and reject cache-like paths in the chooser.
        const env = {...process.env}
        delete env.PUPPETEER_CACHE_DIR
        systemBinary = normalizePath(locateChromium({env}) || null)
      } catch {}
      const choice = utils.chooseChromiumBinaryPreferringStable({
        managedSnapshotBinary: browserBinaryLocation,
        systemBinary: isUsableBinary(systemBinary) ? systemBinary : null,
        managedCacheRoot: String(
          binariesResolver.computeBinariesBaseDir(compilation)
        ),
        preferManagedSnapshot:
          String(process.env.EXTENSION_PREFER_CHROMIUM_SNAPSHOT || '')
            .toLowerCase()
            .trim() === 'true'
      })
      if (choice.swappedToSystem && choice.binary) {
        // eslint-disable-next-line no-console
        console.log(
          messages.preferringSystemBrowserOverSnapshot(
            choice.binary,
            browserBinaryLocation
          )
        )
        browserBinaryLocation = choice.binary
      } else if (choice.usedManagedSnapshot) {
        // eslint-disable-next-line no-console
        console.log(messages.devChannelSnapshotInUse(browserBinaryLocation))
      }
    }

    let skipDetection = Boolean(browserBinaryLocation)
    if (!browserBinaryLocation && isWslEnv()) {
      // WSL+GUI: prefer a Linux-native browser so the dev loop stays on the Linux
      // side; fall back to the Windows binary via /mnt/c when none is available.
      const linuxFallback = resolveWslLinuxBinary(browser)

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
    // Swap any Chrome wrapper script for the real binary under WSL+GUI,
    // because the wrapper closes extra FDs on exec, breaking CDP pipe.
    browserBinaryLocation = preferRealChromeBinary(browserBinaryLocation)

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
      if (
        /\/Applications\/Google Chrome(?: (?:Beta|Dev|Canary))?\.app\/Contents\/MacOS\/Google Chrome/i.test(
          p
        )
      ) {
        return true
      }
      if (/\\Google\\Chrome\\Application\\chrome\.exe$/i.test(p)) return true
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
              printInstallGuidance(getInstallGuidanceText('chrome'), browser)
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
              printInstallGuidance(getInstallGuidanceText('chrome'), browser)
              candidate = null
            }
          }
          const resolved = normalizePath(candidate || null)
          const fallback = resolved || resolveWslFallback()
          if (!fallback) throw err
          return fallback
        }
      } catch (error) {
        printInstallGuidance(String(error), browser)
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

      // Chromium forks located from the user's system, each via its dedicated
      // *-location resolver; the shared not-found block prints install guidance.
      case 'brave':
      case 'opera':
      case 'vivaldi':
      case 'yandex': {
        if (isAuthorMode) console.log(messages.locatingBrowser(browser))

        if (!skipDetection) {
          try {
            const locate =
              browser === 'brave'
                ? locateBrave
                : browser === 'opera'
                  ? locateOpera
                  : browser === 'vivaldi'
                    ? locateVivaldi
                    : locateYandex
            const located = locate(true, {env: process.env})
            const normalized = normalizePath(located || null)
            if (normalized && fs.existsSync(normalized)) {
              browserBinaryLocation = normalized
            }
          } catch {
            // ignore; the shared not-found block below handles guidance
          }
        }

        if (!browserBinaryLocation) {
          browserBinaryLocation = resolveWslFallback()
        }
        break
      }

      case 'chromium': {
        if (isAuthorMode) console.log(messages.locatingBrowser(browser))

        // Prefer an explicit binary; otherwise KEEP the binary already resolved above,
        // or the post-switch fallback would re-resolve the managed snapshot.
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
          } catch {}
        }
        if (!browserBinaryLocation) {
          browserBinaryLocation = resolveWslFallback()
        }
        break
      }

      case 'edge': {
        if (isAuthorMode) console.log(messages.locatingBrowser(browser))

        try {
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
        browserBinaryLocation = this.options?.chromiumBinary || null
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
          } catch {}
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

      // Requested browser missing everywhere, but another managed chromium-family
      // binary is a working substitute; prefer it over aborting.
      if (
        (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) &&
        (browser === 'chrome' || browser === 'chromium')
      ) {
        const familyFallback = binariesResolver.resolveChromiumFamilyFallback(
          compilation,
          browser
        )
        const normalized = normalizePath(familyFallback?.binary || null)

        if (familyFallback && isUsableBinary(normalized)) {
          // eslint-disable-next-line no-console
          console.log(
            messages.usingManagedChromiumFamilyFallback(
              browser,
              familyFallback.browser,
              normalized
            )
          )
          browserBinaryLocation = normalized
        }
      }

      if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
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
              browser,
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

    let browserVersionLine: string | undefined
    try {
      const vLine = getBrowserVersionLine(browserBinaryLocation)
      if (vLine && vLine.trim().length > 0) {
        browserVersionLine = vLine.trim()
      }
    } catch {
      // ignore – banner will fall back to generic browser label
    }

    // Always name the exact binary this session runs (one line). A silently
    // preferred cached snapshot must be visible in dev output.
    // eslint-disable-next-line no-console
    console.log(
      messages.resolvedBrowserBinary(
        browser,
        browserBinaryLocation,
        browserVersionLine
      )
    )

    const extensionsToLoad = toExtensionLoadList(this.options.extension)

    // Dotted version of the resolved binary ("Google Chrome 150.0.7871.24"
    // -> "150.0.7871.24") for the minimum_chrome_version blocker check.
    const resolvedBrowserVersion = /(\d+(?:\.\d+){0,3})/.exec(
      browserVersionLine || ''
    )?.[1]

    // Manifest shapes modern Chromium refuses outright surface only as a native
    // modal (or nothing) and wedge the session; say why up front, before the spawn.
    for (const extPath of extensionsToLoad) {
      try {
        const m = JSON.parse(
          fs.readFileSync(path.join(String(extPath), 'manifest.json'), 'utf8')
        )
        const refusal = diagnoseChromiumManifestRefusal(m)
        if (refusal === 'mv2') {
          // eslint-disable-next-line no-console
          console.warn(messages.mv2NotSupportedByChromium(String(extPath)))
        } else if (refusal === 'mv3-background-scripts') {
          // eslint-disable-next-line no-console
          console.warn(
            messages.mv3BackgroundScriptsNotSupportedByChromium(String(extPath))
          )
        } else if (refusal === 'unsupported-manifest-version') {
          // eslint-disable-next-line no-console
          console.warn(
            messages.unsupportedManifestVersionOnChromium(
              String(extPath),
              m?.manifest_version
            )
          )
        }
        const invalidPatterns = findInvalidMatchPatterns(m)
        if (invalidPatterns.length) {
          // eslint-disable-next-line no-console
          console.warn(
            messages.chromiumInvalidMatchPatterns(
              String(extPath),
              invalidPatterns
            )
          )
        }
        const loadBlockers = [
          ...findChromiumLoadBlockers(m, resolvedBrowserVersion),
          ...findUnloadableIconFiles(m, String(extPath)),
          ...findLocaleLoadBlockers(m, String(extPath)),
          ...findMissingManagedSchema(m, String(extPath))
        ]
        if (loadBlockers.length) {
          // eslint-disable-next-line no-console
          console.warn(
            messages.chromiumManifestLoadBlockers(String(extPath), loadBlockers)
          )
        }
      } catch {
        // unreadable manifest. The browser will complain on its own
      }
    }

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

    const usePipe = chromiumConfig.includes('--remote-debugging-pipe')
    this.closeHandlerContext = {
      isDevMode: compilation.options.mode === 'development',
      extensionOutputPath:
        getExtensionOutputPath(
          compilation,
          chromiumConfig.find((flag: string) =>
            flag.startsWith('--load-extension=')
          )
        ) || undefined
    }
    const child = await this.launchWithDirectSpawn(
      browserBinaryLocation,
      chromiumConfig,
      usePipe
    )

    // Extract pipe streams for CDP transport: child.stdio[3] writes commands to
    // Chrome, child.stdio[4] reads responses.
    const pipeStreams =
      usePipe && child?.stdio?.[3] && child?.stdio?.[4]
        ? {
            input: child.stdio[4] as import('stream').Readable,
            output: child.stdio[3] as import('stream').Writable
          }
        : undefined

    if (enableCdp && !pipeStreams) {
      let portReady = false
      for (let attempt = 0; attempt < 10; attempt++) {
        portReady = await checkChromeRemoteDebugging(selectedPort)
        if (portReady) break
        await new Promise((r) => setTimeout(r, 500))
      }
      if (!portReady && process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.logger.warn?.(
          `[browser] Debug port ${selectedPort} not bound after spawn. CDP may fail`
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
      } catch {}

      const cdpConfig: ChromiumPluginRuntime = {
        ...pickSharedBrowserRuntimeOptions({
          ...this.options,
          extension: extensionsToLoad
        }),
        chromiumBinary: this.options.chromiumBinary,
        logSink: this.options.logSink,
        bannerPrintedOnce: false,
        cdpController: undefined,
        browserVersionLine
      }

      // Optional CDP wiring (dev + inspection). Run-only preview disables this
      // to avoid pulling in WS/CDP dependencies.
      if (enableCdp) {
        const mod = await import('./setup-cdp-after-launch')
        // Watchdog: a rejected extension at launch stalls startup behind a macOS modal
        // and the pipe handshake hangs forever; convert that silent wedge into a loud failure.
        const CDP_SETUP_TIMEOUT_MS = 45_000
        await Promise.race([
          mod.setupCdpAfterLaunch(
            compilation,
            cdpConfig,
            chromiumConfig,
            pipeStreams
          ),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `CDP setup did not complete within ${
                      CDP_SETUP_TIMEOUT_MS / 1000
                    }s. Chrome likely rejected the extension at launch, open chrome://extensions in the dev browser window for the exact error. Common causes: MV3 content_security_policy with 'unsafe-inline', manifest keys Chrome does not support, or manifest references to files missing from the output. Reload/HMR cannot attach until this is fixed.`
                  )
                ),
              CDP_SETUP_TIMEOUT_MS
            ).unref?.()
          )
        ])

        if (cdpConfig.cdpController) {
          this.ctx.setController(
            cdpConfig.cdpController as CDPExtensionController
          )
        }
      }
    } catch (error) {
      // A dead CDP wire means no reload delivery for the whole session,
      // always tell the user (previously author-mode-only, i.e. silent).
      const message = String(error && (error as Error).message)
      const hint = /timed out|did not complete/i.test(message)
        ? " Chrome likely rejected the extension at launch, open chrome://extensions in the dev browser window for the exact error. Common causes: MV3 content_security_policy with 'unsafe-inline', manifest keys Chrome does not support, or manifest references to missing files. Reload/HMR cannot attach until this is fixed."
        : ''
      console.error(`[browser] ${message}${hint}`)
    }
  }

  private async launchWithDirectSpawn(
    binary: string,
    chromeFlags: string[],
    usePipe: boolean = false
  ) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      this.logger.info(messages.chromeInitializingEnhancedReload())
    }
    const launchArgs = this.options?.startingUrl
      ? [...chromeFlags, this.options.startingUrl]
      : [...chromeFlags]

    // --remote-debugging-pipe talks over fds 3 & 4. stderr is PIPED and drained so
    // extension-load rejections reach the user instead of silently wedging dev.
    const stdio: import('child_process').StdioOptions = usePipe
      ? ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']
      : ['ignore', 'ignore', 'pipe']

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

      // Drain stderr (required, an unread pipe eventually blocks Chrome) and
      // surface extension-load rejections, which otherwise die silently.
      const stderrStream = (
        child as {
          stdio?: Array<{
            on?: (ev: string, cb: (chunk: Buffer) => void) => void
          }>
        }
      ).stdio?.[2]
      if (stderrStream && typeof stderrStream.on === 'function') {
        let pending = ''
        stderrStream.on('data', (chunk: Buffer) => {
          pending += String(chunk)
          let newline: number
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline).trim()
            pending = pending.slice(newline + 1)
            if (
              /Failed to load extension|Manifest file is missing or unreadable|Manifest is not valid JSON/i.test(
                line
              )
            ) {
              this.logger.error(
                `[browser] Chrome rejected an extension at launch, reload/HMR cannot attach until this is fixed:\n${line}`
              )
            }
          }
        })
        stderrStream.on('error', () => {})
      }

      let disposeSignalHandlers: (() => void) | undefined

      child.on('close', (code: number | null) => {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.logger.info(messages.chromeProcessExited(code || 0))
        }
        // An exit we didn't ask for means the browser died out from under a live
        // session. Say so loudly and stamp ready.json so automation sees it too.
        if (!wasTerminatedByUs(child)) {
          this.logger.error(
            this.closeHandlerContext?.isDevMode
              ? `[browser] ${this.options.browser} exited mid-session (code ${
                  code ?? 'unknown'
                }). The dev server is still running but reloads cannot be delivered, restart "extension dev" to relaunch the browser.`
              : `[browser] ${this.options.browser} exited (code ${
                  code ?? 'unknown'
                }); the preview session is over.`
          )
          stampReadyBrowserExited(
            this.closeHandlerContext?.extensionOutputPath,
            code
          )
        }
        disposeSignalHandlers?.()

        const userDataDir = launchArgs
          .find((arg) => arg.startsWith('--user-data-dir='))
          ?.slice('--user-data-dir='.length)
          .replace(/^"|"$/g, '')
        utils.removeManagedEphemeralProfile(userDataDir)
      })

      child.on('error', (error) => {
        this.logger.error(messages.chromeProcessError(error))
      })

      disposeSignalHandlers = setupProcessSignalHandlers(
        this.options?.browser,
        child,
        () => {}
      )

      return child
    } catch (error) {
      this.logger.error(messages.chromeFailedToSpawn(error))
      throw error
    }
  }

  private printEnhancedPuppeteerInstallHint(
    compilation: CompilationLike,
    raw: string,
    browserName?: BrowserType
  ) {
    try {
      const displayCacheDir =
        binariesResolver.computeBinariesBaseDir(compilation)
      const pretty = messages.prettyPuppeteerInstallGuidance(
        browserName || this.options.browser,
        raw,
        displayCacheDir
      )
      console.error(pretty)
    } catch {
      try {
        const pretty = messages.prettyPuppeteerInstallGuidance(
          browserName || this.options.browser,
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
