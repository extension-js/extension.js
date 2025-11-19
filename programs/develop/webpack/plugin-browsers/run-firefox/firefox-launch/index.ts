import * as fs from 'fs'
import {spawn, ChildProcess} from 'child_process'
import type {Compilation, Compiler} from '@rspack/core'
import firefoxLocation from 'firefox-location2'
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
import type {FirefoxContext} from '../firefox-context'
import type {BrowserConfig, DevOptions} from '../../../webpack-types'
import type {FirefoxPluginRuntime} from '../firefox-types'

export class FirefoxLaunchPlugin {
  private readonly host: FirefoxPluginRuntime
  private readonly ctx: FirefoxContext
  private child: ChildProcess | null = null

  constructor(host: FirefoxPluginRuntime, ctx: FirefoxContext) {
    this.host = host
    this.ctx = ctx
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
    const skipDetection = Boolean(browserBinaryLocation)
    const engineBased =
      this.host.browser === 'gecko-based' ||
      this.host.browser === 'firefox-based'

    // Detect Firefox binary via firefox-location2
    try {
      if (this.host.geckoBinary && typeof this.host.geckoBinary === 'string') {
        if (fs.existsSync(this.host.geckoBinary)) {
          browserBinaryLocation = this.host.geckoBinary
        } else {
          console.error(messages.invalidGeckoBinaryPath(this.host.geckoBinary))
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
      if (fallback && fs.existsSync(fallback)) {
        browserBinaryLocation = fallback
      } else {
        if (engineBased || this.host.geckoBinary) {
          console.error(
            this.host.geckoBinary
              ? messages.invalidGeckoBinaryPath(this.host.geckoBinary)
              : messages.requireGeckoBinaryForGeckoBased()
          )
          process.exit(1)
        } else {
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
          this.printInstallHint(compilation, guidance)
          if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
            throw new Error('Firefox not installed or binary path not found')
          } else {
            process.exit(1)
          }
        }
      }
    }

    // At this point TS: ensure non-null string
    const binaryPath = browserBinaryLocation as string

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
      firefoxArgs.push(...binaryArgsMatch[1].split(' '))
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
      const stdio: any = isWin ? 'ignore' : ['pipe', 'pipe', 'pipe']
      this.child = spawn(binary, args, {
        stdio,
        detached: false,
        ...(isWin ? {windowsHide: true} : {})
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

      try {
        if (
          process.env.EXTENSION_AUTHOR_MODE === 'true' &&
          this.host.instanceId &&
          profileMatch
        ) {
          this.ctx.logger?.info?.(
            messages.devFirefoxDebugPort(debugPort, desiredDebugPort)
          )
          this.ctx.logger?.info?.(
            messages.devFirefoxProfilePath(profileMatch[1])
          )
        }
      } catch {}
    } else {
      // Launch with default user profile
      const args: string[] = [
        ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
        '--foreground',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...firefoxArgs
      ]

      const isWin = process.platform === 'win32'
      const stdio: any = isWin ? 'ignore' : ['pipe', 'pipe', 'pipe']
      this.child = spawn(binaryPath, args, {
        stdio,
        detached: false,
        ...(isWin ? {windowsHide: true} : {})
      })
      this.wireChildLifecycle(compilation, debugPort, desiredDebugPort)
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
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        this.ctx.logger?.info?.(
          messages.browserInstanceExited(this.host.browser)
        )
      }
      this.cleanupInstance().finally(() => {
        process.exit()
      })
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
