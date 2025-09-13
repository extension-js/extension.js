import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler} from '@rspack/core'
import {spawn, type ChildProcess} from 'child_process'
import * as chromeLocation from 'chrome-location2'
import edgeLocation from 'edge-location'
import {browserConfig} from './browser-config'
import * as messages from '../browsers-lib/messages'
import {PluginInterface} from '../browsers-types'
import {DevOptions} from '../../../develop-lib/config-types'
import {DynamicExtensionManager} from '../browsers-lib/dynamic-extension-manager'
import {InstanceManager} from '../browsers-lib/instance-manager'
import {
  deriveDebugPortWithInstance,
  findAvailablePortNear
} from '../browsers-lib/shared-utils'
import {
  getDefaultProfilePath,
  isChromiumProfileLocked,
  chooseEffectiveInstanceId
} from '../browsers-lib/shared-utils'

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
  public readonly reuseProfile?: boolean
  public readonly dryRun?: boolean
  private browserProcess?: ChildProcess

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
    this.reuseProfile = (options as any).reuseProfile
    this.dryRun = (options as any).dryRun
  }

  private async launchChromium(
    compilation: Compilation,
    browser: DevOptions['browser']
  ) {
    // Extra guard: never launch if compilation has errors
    const compilationErrors = compilation?.errors || []
    
    if (compilationErrors.length > 0) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.skippingBrowserLaunchDueToCompileErrors())
      }
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
          console.error(
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
      console.error(
        messages.browserNotInstalledError(browser, browserBinaryLocation)
      )
      // Avoid killing the test runner during unit tests
      if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
        throw new Error('Browser not installed or binary path not found')
      } else {
        process.exit(1)
      }
    }

    // Get the current instance first to get the correct project path
    const instanceManager = new InstanceManager(
      (compilation as any).options?.context || process.cwd()
    )
    let currentInstance = null
    if (this.instanceId) {
      currentInstance = await instanceManager.getInstance(this.instanceId)
    }

    // Use the project path from the instance, or fallback to compiler context
    const projectPath =
      currentInstance?.projectPath ||
      (compilation as any).options?.context ||
      process.cwd()
    const extensionManager = new DynamicExtensionManager(projectPath)

    // Prepare extensions list with dynamic manager extension
    let extensionsToLoad = Array.isArray(this.extension)
      ? [...this.extension]
      : [this.extension]

    if (currentInstance) {
      const generatedExtension =
        await extensionManager.regenerateExtensionIfNeeded(currentInstance)
      extensionsToLoad = [...extensionsToLoad, generatedExtension.extensionPath]
    }

    // Smart profile reuse with graceful fallback
    let effectiveInstanceId: string | undefined = this.instanceId
    try {
      const running = await instanceManager.getRunningInstances()
      const concurrent = running.some(
        (i) => i.status === 'running' && i.browser === this.browser
      )
      const browserSpecificOutputPath =
        ((compilation as any).options?.output?.path as string) ||
        process.cwd() + '/dist'
      const mainOutputPath = path.dirname(browserSpecificOutputPath)
      const baseProfilePath = getDefaultProfilePath(
        mainOutputPath,
        this.browser
      )
      const lockPresent = isChromiumProfileLocked(baseProfilePath)
      effectiveInstanceId = chooseEffectiveInstanceId(
        this.reuseProfile,
        concurrent,
        lockPresent,
        this.instanceId
      )
    } catch {
      effectiveInstanceId = this.instanceId
    }

    let chromiumConfig: string[]
    try {
      // Choose profile path: if another Chromium session is running or the base profile is locked,
      // switch to a per-instance managed profile so Chrome honors --load-extension flags.
      const concurrent = (await instanceManager.getRunningInstances()).some(
        (i) => i.status === 'running' && i.browser === this.browser
      )
      const baseLocked = isChromiumProfileLocked(
        getDefaultProfilePath(
          path.dirname(
            ((compilation as any).options?.output?.path as string) ||
              process.cwd() + '/dist'
          ),
          this.browser
        )
      )
      const profileForConfig =
        concurrent || baseLocked ? undefined : this.profile
      chromiumConfig = browserConfig(compilation, {
        ...this,
        profile: profileForConfig,
        instanceId: effectiveInstanceId,
        extension: extensionsToLoad
      } as any)

      // One-time dev hint when falling back
      if (
        process.env.EXTENSION_ENV === 'development' &&
        (concurrent || baseLocked)
      ) {
        try {
          console.warn(
            messages.profileFallbackWarning(
              this.browser,
              concurrent ? 'concurrent session' : 'profile lock detected'
            )
          )
        } catch {}
      }
    } catch (error) {
      // Fallback: if shared profile creation fails, retry with per-instance profile
      if ((this.reuseProfile as boolean | undefined) !== false) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.warn(
            `Falling back to per-instance profile due to error: ${String(error)}`
          )
        }
        chromiumConfig = browserConfig(compilation, {
          ...this,
          instanceId: this.instanceId,
          extension: extensionsToLoad
        } as any)
      } else {
        throw error
      }
    }

    // Ensure CDP port availability if source inspection enabled
    if (this.source || this.watchSource) {
      const desiredPort = deriveDebugPortWithInstance(
        this.port as any,
        this.instanceId
      )
      const freePort = await findAvailablePortNear(desiredPort)
      if (freePort !== desiredPort) {
        // Replace port occurrences in flags
        chromiumConfig = chromiumConfig.map((flag) =>
          flag.startsWith('--remote-debugging-port=')
            ? `--remote-debugging-port=${freePort}`
            : flag
        )
      }
      // Persist final chosen debug port to instance metadata
      try {
        if (this.instanceId) {
          await instanceManager.updateInstance(this.instanceId, {
            debugPort: freePort
          })
          if (process.env.EXTENSION_ENV === 'development') {
            console.log(messages.devChromiumDebugPort(freePort, desiredPort))
          }
        }
      } catch {}
    }

    if (this.dryRun) {
      console.log(messages.chromeInitializingEnhancedReload())
      console.log('[plugin-browsers] Dry run: not launching browser')
      console.log('[plugin-browsers] Binary:', browserBinaryLocation)
      console.log('[plugin-browsers] Flags:', chromiumConfig.join(' '))
      return
    }

    // Use direct spawn for basic functionality
    await this.launchWithDirectSpawn(browserBinaryLocation, chromiumConfig)
  }

  private async launchWithDirectSpawn(
    browserBinaryLocation: string,
    chromeFlags: string[]
  ) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.chromeInitializingEnhancedReload())
    }

    // Ensure flags come first so Chrome acknowledges them; URL last
    const launchArgs = this.startingUrl
      ? [...chromeFlags, this.startingUrl]
      : [...chromeFlags]

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'

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

      // Store child process reference for cleanup
      this.browserProcess = child

      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          '[plugin-browsers] Final Chrome flags:',
          launchArgs.join(' ')
        )
        child.stdout?.pipe(process.stdout)
        child.stderr?.pipe(process.stderr)
      }

      child.on('close', (code: number | null) => {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.chromeProcessExited(code || 0))
        }
        // Clean up instance when browser closes
        this.cleanupInstance()
      })

      child.on('error', (error) => {
        console.error(messages.chromeProcessError(error))
        this.cleanupInstance()
      })

      // Enhanced signal handling for AI usage
      this.setupProcessSignalHandlers(child)
    } catch (error) {
      console.error(messages.chromeFailedToSpawn(error))
      throw error
    }
  }

  private setupProcessSignalHandlers(child: ChildProcess) {
    const cleanup = () => {
      try {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.enhancedProcessManagementCleanup(this.browser))
        }

        // Terminate browser process gracefully
        if (child && !child.killed) {
          if (process.env.EXTENSION_ENV === 'development') {
            console.log(
              messages.enhancedProcessManagementTerminating(this.browser)
            )
          }
          child.kill('SIGTERM')

          // Force kill after timeout if needed
          setTimeout(() => {
            if (child && !child.killed) {
              if (process.env.EXTENSION_ENV === 'development') {
                console.log(
                  messages.enhancedProcessManagementForceKill(this.browser)
                )
              }
              child.kill('SIGKILL')
            }
          }, 5000)
        }

        // Clean up instance
        this.cleanupInstance()
      } catch (error) {
        console.error(
          messages.enhancedProcessManagementCleanupError(this.browser, error)
        )
      }
    }

    // Handle various termination signals
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    process.on('SIGHUP', cleanup)
    process.on('exit', cleanup)

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error(
        messages.enhancedProcessManagementUncaughtException(this.browser, error)
      )
      cleanup()
      process.exit(1)
    })

    process.on('unhandledRejection', (reason) => {
      console.error(
        messages.enhancedProcessManagementUnhandledRejection(
          this.browser,
          reason
        )
      )
      cleanup()
      process.exit(1)
    })
  }

  private async cleanupInstance() {
    if (this.instanceId) {
      try {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.enhancedProcessManagementInstanceCleanup(this.browser)
          )
        }
        const instanceManager = new InstanceManager(process.cwd())
        await instanceManager.terminateInstance(this.instanceId)

        // Force cleanup of orphaned instances
        await instanceManager.forceCleanupOrphanedInstances()
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.enhancedProcessManagementInstanceCleanupComplete(
              this.browser
            )
          )
        }
      } catch (error) {
        console.error(
          messages.enhancedProcessManagementCleanupError(this.browser, error)
        )
      }
    }
  }

  apply(compiler: Compiler) {
    let chromiumDidLaunch = false

    compiler.hooks.done.tapAsync(
      'run-browsers:module',
      (stats: any, done: any) => {
        const hasErrors =
          typeof stats?.hasErrors === 'function'
            ? stats.hasErrors()
            : !!stats?.compilation?.errors?.length

        if (hasErrors) {
          try {
            const compileErrors: any[] = stats?.compilation?.errors || []
            const manifestErrors = compileErrors.filter((err) => {
              const msg: string = String(
                (err && (err.message || err.toString())) || ''
              )
              return (
                msg.includes('manifest.json') && msg.includes('File Not Found')
              )
            })
            if (
              manifestErrors.length &&
              process.env.EXTENSION_ENV === 'development'
            ) {
              console.log(
                messages.manifestPreflightSummary(manifestErrors.length)
              )
            }
          } catch {}

          if (process.env.EXTENSION_ENV === 'development') {
            console.log(messages.skippingBrowserLaunchDueToCompileErrors())
          }
          done()
          return
        }

        if (chromiumDidLaunch) {
          done()
          return
        }

        this.launchChromium(stats as any, this.browser).then(() => {
          console.log(
            messages.stdoutData(
              this.browser,
              stats.compilation.options.mode as 'development' | 'production'
            )
          )
        })

        chromiumDidLaunch = true
        done()
      }
    )
  }
}
