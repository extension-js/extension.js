import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler} from '@rspack/core'
import {spawn} from 'child_process'
import * as chromeLocation from 'chrome-location2'
import edgeLocation from 'edge-location'
import {launch} from 'chrome-launcher'
import {browserConfig} from './browser-config'
import * as messages from '../browsers-lib/messages'
import {PluginInterface} from '../browsers-types'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {DynamicExtensionManager} from '../../lib/dynamic-extension-manager'
import {InstanceManager} from '../../lib/instance-manager'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export class RunChromiumPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags?: string[]
  public readonly excludeBrowserFlags?: string[]
  public readonly profile?: string
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string
  public readonly autoReload?: boolean
  public readonly stats?: boolean
  public readonly chromiumBinary?: string
  public readonly port?: number
  public readonly instanceId?: string
  public readonly enableCDP?: boolean

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
    this.enableCDP = (options as any)?.enableCDP !== false
  }

  private async launchChromium(
    compilation: Compilation,
    browser: DevOptions['browser']
  ) {
    let browserBinaryLocation: string

    switch (browser) {
      case 'chrome':
        browserBinaryLocation = chromeLocation.default()
        console.log('🔍 Chrome location detected:', browserBinaryLocation)
        break

      case 'edge':
        browserBinaryLocation = edgeLocation()
        break

      case 'chromium-based':
        browserBinaryLocation = path.normalize(this.chromiumBinary!)
        break

      default:
        browserBinaryLocation = chromeLocation.default()
        break
    }

    // Enhanced Chrome detection for macOS
    if (
      browser === 'chrome' &&
      (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation))
    ) {
      const macChromePath =
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      if (fs.existsSync(macChromePath)) {
        browserBinaryLocation = macChromePath
        console.log('🔍 Using macOS Chrome path:', browserBinaryLocation)
      }
    }

    if (!browserBinaryLocation || !fs.existsSync(browserBinaryLocation)) {
      console.error(
        messages.browserNotInstalledError(browser, browserBinaryLocation)
      )
      process.exit()
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

    // Add the dynamic manager extension if we have an instance
    if (currentInstance) {
      const generatedExtension =
        await extensionManager.regenerateExtensionIfNeeded(currentInstance)
      extensionsToLoad.push(generatedExtension.extensionPath)
    }

    const chromiumConfig = browserConfig(compilation, {
      ...this,
      extension: extensionsToLoad,
      enableCDP: this.enableCDP
    })

    if (this.enableCDP) {
      // Use chrome-launcher for CDP support
      await this.launchWithCDP(browserBinaryLocation, chromiumConfig)
    } else {
      // Use direct spawn for basic functionality
      await this.launchDirect(browserBinaryLocation, chromiumConfig)
    }
  }

  private async launchWithCDP(
    browserBinaryLocation: string,
    chromeFlags: string[]
  ) {
    console.log(
      '🔧 Initializing enhanced reload service for Chromium-based browser'
    )

    const launchOptions = {
      chromePath: browserBinaryLocation,
      chromeFlags,
      startingUrl: this.startingUrl,
      logLevel: (process.env.EXTENSION_ENV === 'development'
        ? 'verbose'
        : 'silent') as 'verbose' | 'silent',
      ignoreDefaultFlags: true
    }

    try {
      const chromeInstance = await launch(launchOptions)

      console.log('🔧 Chrome launched with CDP support')
      console.log('   Process ID:', chromeInstance.pid)

      // Store the chrome instance for potential extension reloading
      ;(global as any).__extensionChromeInstance = chromeInstance

      chromeInstance.process.on('close', (code: number | null) => {
        console.log(`🔧 Chrome process exited with code: ${code}`)
      })
    } catch (error) {
      console.error('🔧 Failed to launch Chrome with CDP:', error)
      // Fallback to direct launch
      await this.launchDirect(browserBinaryLocation, chromeFlags)
    }
  }

  private async launchDirect(
    browserBinaryLocation: string,
    chromeFlags: string[]
  ) {
    const launchArgs = this.startingUrl
      ? [this.startingUrl, ...chromeFlags]
      : [...chromeFlags]

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'

    console.log('🔍 Spawning browser with:', {
      binary: browserBinaryLocation,
      args: launchArgs
    })

    const child = spawn(`${browserBinaryLocation}`, launchArgs, {stdio})

    if (process.env.EXTENSION_ENV === 'development') {
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    }
  }

  apply(compiler: Compiler) {
    let chromiumDidLaunch = false

    compiler.hooks.done.tapAsync('run-browsers:module', (compilation, done) => {
      if (compilation.compilation.errors.length > 0) {
        done()
        return
      }

      if (chromiumDidLaunch) {
        done()
        return
      }

      this.launchChromium(compilation as any, this.browser)

      setTimeout(() => {
        console.log(
          messages.stdoutData(
            this.browser,
            compilation.compilation.options.mode as 'development' | 'production'
          )
        )
        if (this.instanceId) {
          console.log(`   Instance: ${this.instanceId.slice(0, 8)}`)
        }
      }, 2000)

      chromiumDidLaunch = true
      done()
    })
  }
}
