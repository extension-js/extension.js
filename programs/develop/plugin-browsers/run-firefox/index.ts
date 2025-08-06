import * as fs from 'fs'
import * as path from 'path'
import {spawn, ChildProcess} from 'child_process'
import {type Compiler, type Compilation} from '@rspack/core'
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
import {DynamicExtensionManager} from '../../lib/dynamic-extension-manager'

let child: ChildProcess | null = null

process.on('SIGINT', () => {
  if (child) {
    // Send SIGINT to the child process
    child.kill('SIGINT')
  }
  process.exit()
})

process.on('SIGTERM', () => {
  if (child) {
    // Send SIGTERM to the child process
    child.kill('SIGTERM')
  }
  process.exit()
})

export class RunFirefoxPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags?: string[]
  public readonly profile?: string
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string
  public readonly autoReload?: boolean
  public readonly stats?: boolean
  public readonly geckoBinary?: string
  public readonly port?: number
  public readonly instanceId?: string
  public readonly keepProfileChanges?: boolean
  public readonly copyFromProfile?: string

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser || 'firefox'
    this.browserFlags = options.browserFlags || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
    this.geckoBinary = options.geckoBinary
    this.port = options.port
    this.instanceId = options.instanceId
    this.keepProfileChanges = (options as any)?.keepProfileChanges
    this.copyFromProfile = (options as any)?.copyFromProfile

    console.log(
      '🔍 RunFirefoxPlugin constructor finished, this.port:',
      this.port
    )
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

    // Add the dynamic manager extension if we have an instance
    if (currentInstance) {
      const generatedExtension =
        await extensionManager.regenerateExtensionIfNeeded(currentInstance)
      extensionsToLoad.push(generatedExtension.extensionPath)
    }

    // Store the extensions in the compilation context for RemoteFirefox to use
    ;(compilation as any).firefoxExtensions = extensionsToLoad

    const firefoxConfig = await browserConfig(compilation, {
      ...options,
      profile: this.profile,
      preferences: this.preferences,
      keepProfileChanges: this.keepProfileChanges,
      copyFromProfile: this.copyFromProfile
    })

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

    // Extract profile path
    const profileMatch = firefoxConfig.match(/--profile="([^"]*)"/)
    if (profileMatch) {
      const profilePath = profileMatch[1]

      // Generate Firefox arguments based on binary type
      const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
        browserBinaryLocation,
        profilePath,
        this.port ? this.port + 100 : 9222,
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
        if (code === 0) {
          console.log(messages.browserInstanceExited(this.browser))
        } else {
          console.log(messages.browserInstanceExited(this.browser))
        }
        process.exit()
      })

      if (process.env.EXTENSION_ENV === 'development' && child) {
        child.stdout?.pipe(process.stdout)
        child.stderr?.pipe(process.stderr)
      }

      // Wait a minimal time for Firefox to start up (optimized from 3s to 1s)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Inject the add-ons code into Firefox profile.
      const remoteFirefox = new RemoteFirefox(this)

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
    } else {
      console.error(messages.firefoxFailedToExtractProfilePath())
      process.exit(1)
    }
  }

  apply(compiler: any) {
    console.log(messages.firefoxRunFirefoxPluginApplyArguments(arguments))
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

          // Only show success message after Firefox has successfully started and add-ons installed
          setTimeout(() => {
            console.log(
              messages.stdoutData(
                this.browser,
                stats.compilation.options.mode as DevOptions['mode']
              )
            )
          }, 2000)

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
}
