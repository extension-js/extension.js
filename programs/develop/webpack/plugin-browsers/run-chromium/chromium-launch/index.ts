import * as fs from 'fs'
import {spawn, execFileSync} from 'child_process'
import type {Compilation, Compiler} from '@rspack/core'
import * as chromeLocation from 'chrome-location2'
import chromiumLocation from 'chromium-location'
import edgeLocation from 'edge-location'
import * as messages from '../../browsers-lib/messages'
import * as instanceRegistry from '../../browsers-lib/instance-registry'
import * as binariesResolver from '../../browsers-lib/output-binaries-resolver'
import * as utils from '../../browsers-lib/shared-utils'
import {browserConfig} from './browser-config'
import {setupProcessSignalHandlers} from './process-handlers'
import {logChromiumDryRun} from './dry-run'
import {setupCdpAfterLaunch} from './setup-cdp-after-launch'
import type {ChromiumContext} from '../chromium-context'
import type {
  ChromiumLaunchOptions,
  ChromiumPluginRuntime
} from '../chromium-types'
import type {CDPExtensionController} from '../chromium-source-inspection/cdp-extension-controller'

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
  private logger!: ReturnType<Compiler['getInfrastructureLogger']>

  constructor(
    private readonly options: ChromiumLaunchOptions,
    private readonly ctx: ChromiumContext
  ) {}

  apply(compiler: Compiler) {
    this.logger =
      typeof compiler?.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger('ChromiumLaunchPlugin')
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
          } as ReturnType<Compiler['getInfrastructureLogger']>)

    compiler.hooks.done.tapPromise('chromium:launch', async (stats) => {
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
        this.logger.info(
          messages.stdoutData(
            this.options.browser,
            stats.compilation.options.mode as 'development' | 'production'
          )
        )
      } catch {
        // fall through
      }
    })
  }

  private async launchChromium(compilation: Compilation) {
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

    try {
      const resolved = binariesResolver.resolveFromBinaries(
        compilation,
        browser === 'chromium' || browser === 'chromium-based'
          ? 'chromium'
          : browser === 'edge'
            ? 'edge'
            : 'chrome'
      )
      if (resolved && fs.existsSync(resolved)) {
        browserBinaryLocation = resolved
      }
    } catch {
      // ignore
    }

    const skipDetection = Boolean(browserBinaryLocation)

    const getChromeVersionLine = (bin: string): string => {
      try {
        const versionLine = execFileSync(bin, ['--version'], {
          encoding: 'utf8'
        }).trim()

        if (versionLine) return versionLine
      } catch {
        // ignore
      }

      if (process.platform === 'win32') {
        try {
          const psPath = bin.replace(/'/g, "''")
          const pv = execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `(Get-Item -LiteralPath '${psPath}').VersionInfo.ProductVersion`
            ],
            {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}
          ).trim()
          const pn = execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `(Get-Item -LiteralPath '${psPath}').VersionInfo.ProductName`
            ],
            {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}
          ).trim()

          if (pv) return pn ? `${pn} ${pv}` : pv
        } catch {
          // ignore
        }
      }
      return ''
    }
    const looksOfficialChrome = (line: string): boolean =>
      /^Google Chrome\s(?!for Testing)/i.test(line)

    const getInstallGuidanceText = (): string => {
      try {
        const f = (chromeLocation as any)?.getInstallGuidance
        const txt = typeof f === 'function' ? f() : ''
        return txt && typeof txt === 'string'
          ? txt
          : 'npx @puppeteer/browsers install chrome@stable'
      } catch {
        return 'npx @puppeteer/browsers install chrome@stable'
      }
    }

    switch (browser) {
      case 'chrome': {
        console.log(messages.locatingBrowser(browser))

        if (!skipDetection) {
          try {
            const locate = (chromeLocation as any).locateChromeOrExplain
            if (typeof locate === 'function') {
              try {
                const located: string = locate({allowFallback: true})

                if (located && fs.existsSync(located)) {
                  const versionLine = getChromeVersionLine(located)

                  if (looksOfficialChrome(versionLine)) {
                    this.printEnhancedPuppeteerInstallHint(
                      compilation,
                      getInstallGuidanceText(),
                      browser
                    )
                    printedGuidance = true
                    browserBinaryLocation = null
                  } else {
                    browserBinaryLocation = located
                  }
                } else {
                  browserBinaryLocation = null
                }
              } catch (err) {
                let candidate: string | null =
                  (chromeLocation as any).default?.(true) || null

                if (candidate) {
                  const versionLine = getChromeVersionLine(candidate)

                  if (looksOfficialChrome(versionLine)) {
                    this.printEnhancedPuppeteerInstallHint(
                      compilation,
                      getInstallGuidanceText(),
                      browser
                    )
                    printedGuidance = true
                    candidate = null
                  }
                }

                browserBinaryLocation = candidate
                if (!browserBinaryLocation) {
                  throw err
                }
              }
            } else {
              let candidate: string | null =
                (chromeLocation as any).default(true) || null

              if (candidate) {
                const versionLine = getChromeVersionLine(candidate)
                if (looksOfficialChrome(versionLine)) {
                  this.printEnhancedPuppeteerInstallHint(
                    compilation,
                    getInstallGuidanceText(),
                    browser
                  )
                  printedGuidance = true
                  candidate = null
                }
              }

              browserBinaryLocation = candidate
            }
          } catch (e) {
            this.printEnhancedPuppeteerInstallHint(
              compilation,
              String(e),
              browser
            )
            printedGuidance = true
            browserBinaryLocation = null
          }
        }
        break
      }

      case 'chromium': {
        console.log(messages.locatingBrowser(browser))

        // Prefer explicit binary when provided
        browserBinaryLocation = this.options?.chromiumBinary || null
        // If user provided a binary, require it to exist
        if (this.options?.chromiumBinary) {
          if (!fs.existsSync(String(this.options.chromiumBinary))) {
            console.error(
              messages.invalidChromiumBinaryPath(
                String(this.options.chromiumBinary)
              )
            )
            process.exit(1)
          }
        }

        if (!browserBinaryLocation && !skipDetection) {
          try {
            const loc = (chromiumLocation as any)?.default || chromiumLocation
            const p = typeof loc === 'function' ? loc() : null
            if (p && typeof p === 'string' && fs.existsSync(p)) {
              browserBinaryLocation = p
            }
          } catch {
            // ignore; not fatal here
          }
        }
        break
      }

      case 'edge': {
        console.log(messages.locatingBrowser(browser))

        try {
          // Honor explicit env override first
          const override = String(process.env.EDGE_BINARY || '').trim()
          if (override) {
            if (fs.existsSync(override)) {
              browserBinaryLocation = override
            } else {
              throw new Error('EDGE_BINARY points to a non-existent path')
            }
          } else {
            browserBinaryLocation = edgeLocation()
            // Validate detected path. If not found, show install guidance just like the catch block.
            if (
              !browserBinaryLocation ||
              !fs.existsSync(String(browserBinaryLocation))
            ) {
              const guidance = (() => {
                try {
                  const f = (edgeLocation as any)?.getInstallGuidance
                  const txt = typeof f === 'function' ? f() : ''
                  return txt && typeof txt === 'string'
                    ? txt
                    : 'npx playwright install msedge'
                } catch {
                  return 'npx playwright install msedge'
                }
              })()

              this.printEnhancedPuppeteerInstallHint(
                compilation,
                guidance,
                'edge'
              )
              printedGuidance = true
              browserBinaryLocation = null

              if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
                throw new Error('Chromium launch failed')
              } else {
                process.exit(1)
              }
            }
          }
        } catch {
          const guidance = (() => {
            try {
              const f = (edgeLocation as any)?.getInstallGuidance
              const txt = typeof f === 'function' ? f() : ''
              return txt && typeof txt === 'string'
                ? txt
                : 'npx playwright install msedge'
            } catch {
              return 'npx playwright install msedge'
            }
          })()

          this.printEnhancedPuppeteerInstallHint(compilation, guidance, 'edge')
          printedGuidance = true
          browserBinaryLocation = null

          if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
            throw new Error('Chromium launch failed')
          } else {
            process.exit(1)
          }
        }
        break
      }

      case 'chromium-based': {
        // Prefer explicit binary; otherwise try chromium-location
        browserBinaryLocation = this.options?.chromiumBinary || null
        // Engine-based requires explicit working binary path
        if (this.options?.chromiumBinary) {
          if (!fs.existsSync(String(this.options.chromiumBinary))) {
            console.error(
              messages.invalidChromiumBinaryPath(
                String(this.options.chromiumBinary)
              )
            )
            process.exit(1)
          }
        } else {
          console.error(messages.requireChromiumBinaryForChromiumBased())
          process.exit(1)
        }
        if (!browserBinaryLocation && !skipDetection) {
          try {
            const loc = (chromiumLocation as any)?.default || chromiumLocation
            const p = typeof loc === 'function' ? loc() : null
            if (p && typeof p === 'string' && fs.existsSync(p)) {
              browserBinaryLocation = p
            }
          } catch {
            // ignore
          }
        }
        break
      }

      default: {
        try {
          const locate = (chromeLocation as any).locateChromeOrExplain

          if (typeof locate === 'function') {
            try {
              const located: string = locate({allowFallback: true})
              if (located && fs.existsSync(located)) {
                const versionLine = getChromeVersionLine(located)
                if (looksOfficialChrome(versionLine)) {
                  this.printEnhancedPuppeteerInstallHint(
                    compilation,
                    getInstallGuidanceText(),
                    browser
                  )
                  printedGuidance = true
                  browserBinaryLocation = null
                } else {
                  browserBinaryLocation = located
                }
              } else {
                browserBinaryLocation = null
              }
            } catch (err) {
              let candidate: string | null =
                (chromeLocation as any).default?.(true) || null

              if (candidate) {
                const versionLine = getChromeVersionLine(candidate)

                if (looksOfficialChrome(versionLine)) {
                  this.printEnhancedPuppeteerInstallHint(
                    compilation,
                    getInstallGuidanceText(),
                    browser
                  )
                  printedGuidance = true
                  candidate = null
                }
              }

              browserBinaryLocation = candidate

              if (!browserBinaryLocation) throw err
            }
          } else {
            let candidate: string | null =
              (chromeLocation as any).default(true) || null

            if (candidate) {
              const versionLine = getChromeVersionLine(candidate)

              if (looksOfficialChrome(versionLine)) {
                this.printEnhancedPuppeteerInstallHint(
                  compilation,
                  getInstallGuidanceText(),
                  browser
                )
                printedGuidance = true
                candidate = null
              }
            }

            browserBinaryLocation = candidate
          }
        } catch (e) {
          this.printEnhancedPuppeteerInstallHint(
            compilation,
            String(e),
            browser
          )
          printedGuidance = true
          browserBinaryLocation = null
        }
        break
      }
    }

    if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
      try {
        const resolved = binariesResolver.resolveFromBinaries(
          compilation,
          browser === 'chromium' || browser === 'chromium-based'
            ? 'chromium'
            : browser === 'edge'
              ? 'edge'
              : 'chrome'
        )

        if (resolved && fs.existsSync(resolved)) {
          browserBinaryLocation = resolved
        }
      } catch {
        // ignore
      }

      if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
        // Always print pretty guidance for Chromium flavors
        if (browser === 'chromium' || browser === 'chromium-based') {
          const chromiumGuidance = (() => {
            try {
              const f = (chromiumLocation as any)?.getInstallGuidance
              const txt = typeof f === 'function' ? f() : ''
              return txt && typeof txt === 'string'
                ? txt
                : 'npx @puppeteer/browsers install chromium'
            } catch {
              return 'npx @puppeteer/browsers install chromium'
            }
          })()
          this.printEnhancedPuppeteerInstallHint(
            compilation,
            chromiumGuidance,
            'chromium'
          )
          printedGuidance = true
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

    const extensionsToLoad = Array.isArray(this.options.extension)
      ? [...this.options.extension]
      : [this.options.extension]

    // Publish extension root once (prefer the USER extension path).
    // Since we now load devtools first and user last, pick the last string entry.
    try {
      const last = [...extensionsToLoad]
        .reverse()
        .find((e) => typeof e === 'string')
      if (last) this.ctx.setExtensionRoot(String(last))
    } catch {
      // ignore
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

    if (this.options.dryRun) {
      logChromiumDryRun(browserBinaryLocation, chromiumConfig)
      return
    }

    await this.launchWithDirectSpawn(browserBinaryLocation, chromiumConfig)

    try {
      const cdpConfig: ChromiumPluginRuntime = {
        extension: Array.isArray(this.options.extension)
          ? this.options.extension
          : [this.options.extension],
        browser: this.options.browser,
        port: this.options.port,
        instanceId: this.options.instanceId,
        bannerPrintedOnce: false,
        logLevel: this.options.logLevel,
        logContexts: this.options.logContexts,
        logUrl: this.options.logUrl,
        logTab: this.options.logTab,
        logFormat: this.options.logFormat,
        logTimestamps: this.options.logTimestamps,
        logColor: this.options.logColor,
        cdpController: undefined,
        noOpen: this.options.noOpen,
        browserFlags: this.options.browserFlags,
        excludeBrowserFlags: this.options.excludeBrowserFlags,
        profile: this.options.profile,
        preferences: this.options.preferences,
        startingUrl: this.options.startingUrl,
        chromiumBinary: this.options.chromiumBinary,
        source: this.options.source,
        watchSource: this.options.watchSource,
        dryRun: this.options.dryRun
      }

      await setupCdpAfterLaunch(compilation, cdpConfig, chromiumConfig)

      if (cdpConfig.cdpController) {
        this.ctx.setController(
          cdpConfig.cdpController as CDPExtensionController,
          selectedPort
        )
      }
    } catch (error) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn(
          '[plugin-browsers] CDP post-launch setup failed:',
          String(error)
        )
      }
    }
  }

  private async launchWithDirectSpawn(binary: string, chromeFlags: string[]) {
    this.logger.info(messages.chromeInitializingEnhancedReload())
    const launchArgs = this.options?.startingUrl
      ? [...chromeFlags, this.options.startingUrl]
      : [...chromeFlags]
    const stdio = 'ignore'

    try {
      const child = spawn(`${binary}`, launchArgs, {
        stdio,
        detached: false,
        ...(process.platform !== 'win32' && {group: process.getgid?.()})
      })

      this.logger.debug?.(
        '[plugin-browsers] Final Chrome flags:',
        launchArgs.join(' ')
      )

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
    compilation: Compilation,
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
