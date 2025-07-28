import * as fs from 'fs'
import * as path from 'path'
import {spawn, ChildProcess} from 'child_process'
import {type Compiler, type Compilation} from '@rspack/core'
import firefoxLocation from 'firefox-location2'
import {browserConfig} from './firefox/browser-config'
import {RemoteFirefox} from './remote-firefox'
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

  constructor(options: PluginInterface) {
    console.log('🔍 RunFirefoxPlugin constructor called with options:', options)
    console.log('🔍 RunFirefoxPlugin port from options:', options.port)

    this.extension = options.extension
    this.browser = options.browser || 'firefox'
    this.browserFlags = options.browserFlags || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
    this.geckoBinary = options.geckoBinary
    this.port = options.port
    this.instanceId = options.instanceId

    console.log(
      '🔍 RunFirefoxPlugin constructor finished, this.port:',
      this.port
    )
  }

  private async launchFirefox(
    compilation: Compilation,
    options: DevOptions & BrowserConfig
  ) {
    console.log('🚀 launchFirefox called!')

    let browserBinaryLocation: string | null = null

    switch (options.browser) {
      case 'gecko-based':
        browserBinaryLocation = path.normalize(this.geckoBinary!)
        break

      default:
        browserBinaryLocation = firefoxLocation()
        break
    }

    if (!fs.existsSync(browserBinaryLocation || '')) {
      console.error(
        messages.browserNotInstalledError(
          this.browser,
          browserBinaryLocation || ''
        )
      )
      process.exit(1)
    }

    // Get project path from compiler context
    const projectPath = (compilation as any).options?.context || process.cwd()

    // Get the current instance and dynamic extension manager
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

    const firefoxConfig = await browserConfig(compilation, options)

    // Debug: Log the firefox config
    console.log('🔍 Firefox config:', firefoxConfig)
    console.log('🔍 Firefox config length:', firefoxConfig.length)
    console.log(
      '🔍 Firefox config contains --listen:',
      firefoxConfig.includes('--listen')
    )

    // Parse the browser config to extract arguments
    const firefoxArgs: string[] = []

    // Extract binary args
    const binaryArgsMatch = firefoxConfig.match(/--binary-args="([^"]*)"/)
    if (binaryArgsMatch) {
      firefoxArgs.push(...binaryArgsMatch[1].split(' '))
      console.log('🔍 Binary args extracted:', binaryArgsMatch[1])
    } else {
      console.log('🔍 No binary args found')
    }

    // Extract profile path
    const profileMatch = firefoxConfig.match(/--profile="([^"]*)"/)
    if (profileMatch) {
      firefoxArgs.push('-profile', profileMatch[1])
      console.log('🔍 Profile extracted:', profileMatch[1])
    } else {
      console.log('🔍 No profile found')
    }

    // Extract debug port
    const listenMatch = firefoxConfig.match(/--listen=(\d+)/)
    const debugPort = listenMatch ? parseInt(listenMatch[1]) : 9222

    console.log('🔍 Listen match:', listenMatch)
    console.log('🔍 Debug port:', debugPort)
    console.log('🔍 Firefox args before debug:', firefoxArgs)

    // Add Firefox-specific arguments for remote debugging
    firefoxArgs.push(
      '--no-remote',
      '--new-instance',
      `-start-debugger-server=${debugPort}`,
      '--foreground'
    )

    console.log('🔍 Final Firefox args:', firefoxArgs)

    // Launch Firefox directly using spawn
    child = spawn(browserBinaryLocation!, firefoxArgs, {
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

    // Wait a moment for Firefox to start up
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Inject the add-ons code into Firefox profile.
    const remoteFirefox = new RemoteFirefox(this)

    try {
      await remoteFirefox.installAddons(compilation)
    } catch (error) {
      const strErr = error?.toString()
      if (strErr?.includes('background.service_worker is currently disabled')) {
        console.error(messages.firefoxServiceWorkerError(this.browser))
        process.exit(1)
      }

      console.error(messages.browserLaunchError(this.browser, error))
      process.exit(1)
    }
  }

  apply(compiler: any, ...args: any[]): void {
    console.log('🔍 RunFirefoxPlugin.apply arguments:', arguments)
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
            if (this.instanceId) {
              console.log(`   Instance: ${this.instanceId.slice(0, 8)}`)
            }
          }, 2000)

          firefoxDidLaunch = true
        } catch (error) {
          // Don't show success message if Firefox failed to start
          console.error('Firefox failed to start:', error)
          process.exit(1)
        }

        done()
      }
    )
  }
}
