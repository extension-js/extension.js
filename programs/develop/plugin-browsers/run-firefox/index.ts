import {spawn, ChildProcess} from 'child_process'
import {type Compilation} from '@rspack/core'
import {browserConfig} from './firefox/browser-config'
import {RemoteFirefox} from './remote-firefox'
import {FirefoxBinaryDetector} from './firefox/binary-detector'
import * as messages from '../browsers-lib/messages'
import {type PluginInterface} from '../browsers-types'
import {
  BrowserConfig,
  DevOptions
} from '../../commands/commands-lib/config-types'
import {InstanceManager} from '../../lib/instance-manager'
import {DynamicExtensionManager} from '../browsers-lib/dynamic-extension-manager'
import {
  deriveDebugPortWithInstance,
  getDefaultProfilePath,
  isFirefoxProfileLocked,
  chooseEffectiveInstanceId,
  findAvailablePortNear
} from '../browsers-lib/shared-utils'
import * as path from 'path'
import * as fs from 'fs'

let child: ChildProcess | null = null
let isCleaningUp = false

// function toNumberOrUndefined(value: string | number | undefined): number | undefined {
//   if (typeof value === 'number') return value
//   if (typeof value === 'string') {
//     const n = parseInt(value, 10)
//     return Number.isFinite(n) ? n : undefined
//   }
//   return undefined
// }

export class RunFirefoxPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags?: string[]
  public readonly profile?: string | false
  public readonly preferences?: Record<string, any>
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
  public readonly reuseProfile?: boolean
  public readonly dryRun?: boolean

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
    this.source = (options as any).source
    this.watchSource = (options as any).watchSource
    ;(this.reuseProfile as boolean | undefined) = (options as any).reuseProfile
    ;(this.dryRun as boolean | undefined) = (options as any).dryRun

    // Quiet constructor: avoid noisy logs in normal runs
  }

  private async launchFirefox(
    compilation: Compilation,
    options: DevOptions & BrowserConfig
  ) {
    console.log(messages.firefoxLaunchCalled())

    // Detect Firefox binary with enhanced detection
    let browserBinaryLocation: string
    try {
      browserBinaryLocation = await FirefoxBinaryDetector.detectFirefoxBinary(
        this.geckoBinary
      )
      await FirefoxBinaryDetector.validateFirefoxBinary(browserBinaryLocation)
    } catch (error) {
      console.error(messages.firefoxDetectionFailed(error))
      process.exit(1)
    }

    // Get project path from compiler context
    const projectPath = (compilation as any).options?.context || process.cwd()

    // Get the current instance and dynamic Extension.js DevTools
    const instanceManager = new InstanceManager(projectPath)
    const extensionManager = new DynamicExtensionManager(projectPath)

    let currentInstance = null
    if (this.instanceId) {
      currentInstance = await instanceManager.getInstance(this.instanceId)
    }

    // Store extensions for later use in RemoteFirefox
    let extensionsToLoad = Array.isArray(this.extension)
      ? [...this.extension]
      : [this.extension]

    // Add the dynamic manager extension first so it initializes before user extension
    if (currentInstance) {
      const generatedExtension =
        await extensionManager.regenerateExtensionIfNeeded(currentInstance)
      extensionsToLoad = [generatedExtension.extensionPath, ...extensionsToLoad]
    }

    // Store the extensions in the compilation context for RemoteFirefox to use
    ;(compilation as any).firefoxExtensions = extensionsToLoad

    // Instance-based debug port (shared helper) with availability check
    const desiredDebugPort = deriveDebugPortWithInstance(
      this.port,
      this.instanceId
    )
    const debugPort = await findAvailablePortNear(desiredDebugPort)

    // Smart profile reuse with graceful fallback for Firefox
    let effectiveInstanceId: string | undefined = this.instanceId
    try {
      const running = await instanceManager.getRunningInstances()
      const concurrent = running.some(
        (i) => i.status === 'running' && i.browser === this.browser
      )
      const browserSpecificOutputPath =
        (compilation as any).options?.output?.path || process.cwd() + '/dist'
      const mainOutputPath = path.dirname(browserSpecificOutputPath)
      const baseProfilePath = getDefaultProfilePath(
        mainOutputPath,
        this.browser
      )
      const lockPresent = isFirefoxProfileLocked(baseProfilePath)
      effectiveInstanceId = chooseEffectiveInstanceId(
        this.reuseProfile,
        concurrent,
        lockPresent,
        this.instanceId
      )
    } catch {
      effectiveInstanceId = this.instanceId
    }

    let firefoxConfig: string
    try {
      firefoxConfig = await browserConfig(compilation, {
        ...options,
        profile: this.profile,
        preferences: this.preferences,
        keepProfileChanges: this.keepProfileChanges,
        copyFromProfile: this.copyFromProfile,
        instanceId: effectiveInstanceId // unique profiles when concurrent
      })
    } catch (error) {
      if ((this.reuseProfile as boolean | undefined) !== false) {
        console.warn(
          `Falling back to per-instance profile due to error: ${String(error)}`
        )
        firefoxConfig = await browserConfig(compilation, {
          ...options,
          profile: this.profile,
          preferences: this.preferences,
          keepProfileChanges: this.keepProfileChanges,
          copyFromProfile: this.copyFromProfile,
          instanceId: this.instanceId
        })
      } else {
        throw error
      }
    }

    if (this.dryRun) {
      console.log(messages.firefoxLaunchCalled())
      console.log('[plugin-browsers] Dry run: not launching browser')
      console.log('[plugin-browsers] Binary (detected):', browserBinaryLocation)
      console.log('[plugin-browsers] Config:', firefoxConfig)
      return
    }

    // Parse the browser config to extract arguments
    const firefoxArgs: string[] = []

    // Extract binary args
    const binaryArgsMatch = firefoxConfig.match(/--binary-args="([^"]*)"/)
    if (binaryArgsMatch) {
      firefoxArgs.push(...binaryArgsMatch[1].split(' '))
      console.log(messages.firefoxBinaryArgsExtracted(binaryArgsMatch[1]))
    } else {
      console.log(messages.firefoxNoBinaryArgsFound())
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
        console.error(messages.browserLaunchError(this.browser, error))
        process.exit(1)
      })

      child.on('close', (code) => {
        console.log(messages.browserInstanceExited(this.browser))
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
      this.setupProcessSignalHandlers()

      // Connect to Firefox RDP server will be handled by the client with retries

      // Inject the add-ons code into Firefox profile.
      const remoteFirefox = new RemoteFirefox({
        // Satisfy PluginInterface shape
        ...({} as any),
        extension: this.extension,
        browser: this.browser,
        browserFlags: this.browserFlags,
        profile: this.profile,
        preferences: this.preferences,
        startingUrl: this.startingUrl,
        chromiumBinary: undefined,
        geckoBinary: this.geckoBinary,
        instanceId: this.instanceId,
        port: debugPort, // Use the unique debug port
        source: typeof this.source === 'string' ? this.source : undefined,
        watchSource: this.watchSource
      })

      try {
        await remoteFirefox.installAddons(compilation)
      } catch (error) {
        const strErr = error?.toString()
        if (
          strErr?.includes('background.service_worker is currently disabled')
        ) {
          console.error(messages.firefoxServiceWorkerError(this.browser))
          process.exit(1)
        }

        console.error(messages.browserLaunchError(this.browser, error))
        process.exit(1)
      }

      // Source inspection is now handled via webpack plugin step (SetupFirefoxInspectionStep)
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
        console.error(messages.browserLaunchError(this.browser, error))
        process.exit(1)
      })

      child.on('close', (code) => {
        console.log(messages.browserInstanceExited(this.browser))
        this.cleanupInstance().finally(() => {
          process.exit()
        })
      })

      if (process.env.EXTENSION_ENV === 'development' && child) {
        child.stdout?.pipe(process.stdout)
        child.stderr?.pipe(process.stderr)
      }

      this.setupProcessSignalHandlers()
    }
  }

  apply(compiler: any) {
    let firefoxDidLaunch = false

    compiler.hooks.done.tapAsync(
      'run-firefox:module',
      async (stats: any, done: any) => {
        if (stats.compilation.errors.length > 0) {
          done()
          return
        }

        if (firefoxDidLaunch) {
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
          console.log(
            messages.stdoutData(
              this.browser,
              stats.compilation.options.mode as DevOptions['mode']
            )
          )

          firefoxDidLaunch = true
        } catch (error) {
          // Don't show success message if Firefox failed to start
          console.error(messages.firefoxFailedToStart(error))
          process.exit(1)
        }

        done()
      }
    )
  }

  private setupProcessSignalHandlers() {
    const attemptCleanup = async () => {
      if (isCleaningUp) return
      isCleaningUp = true
      try {
        console.log(messages.enhancedProcessManagementCleanup(this.browser))
        if (child && !child.killed) {
          console.log(
            messages.enhancedProcessManagementTerminating(this.browser)
          )
          child.kill('SIGTERM')
          setTimeout(() => {
            if (child && !child.killed) {
              console.log(
                messages.enhancedProcessManagementForceKill(this.browser)
              )
              child.kill('SIGKILL')
            }
          }, 5000)
        }
        await this.cleanupInstance()
      } catch (error) {
        console.error(
          messages.enhancedProcessManagementCleanupError(this.browser, error)
        )
      }
    }

    process.on('exit', () => {
      // Best-effort synchronous cleanup
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
    })

    process.on('uncaughtException', async (error) => {
      console.error(
        messages.enhancedProcessManagementUncaughtException(this.browser, error)
      )
      await attemptCleanup()
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      console.error(
        messages.enhancedProcessManagementUnhandledRejection(
          this.browser,
          reason
        )
      )
      await attemptCleanup()
      process.exit(1)
    })
  }

  private async cleanupInstance() {
    if (!this.instanceId) return
    try {
      console.log(
        messages.enhancedProcessManagementInstanceCleanup(this.browser)
      )
      const instanceManager = new InstanceManager(process.cwd())
      await instanceManager.terminateInstance(this.instanceId)
      await instanceManager.forceCleanupOrphanedInstances()
      console.log(
        messages.enhancedProcessManagementInstanceCleanupComplete(this.browser)
      )
    } catch (error) {
      console.error(
        messages.enhancedProcessManagementCleanupError(this.browser, error)
      )
    }
  }
}
