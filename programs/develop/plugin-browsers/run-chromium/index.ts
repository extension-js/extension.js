import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler} from '@rspack/core'
import {spawn} from 'child_process'
import * as chromeLocation from 'chrome-location2'
import edgeLocation from 'edge-location'
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
  }

  private async launchChromium(
    compilation: Compilation,
    browser: DevOptions['browser']
  ) {
    let browserBinaryLocation: string

    switch (browser) {
      case 'chrome':
        browserBinaryLocation = chromeLocation.default()
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
      extension: extensionsToLoad
    })

    // Use direct spawn for basic functionality
    await this.launchWithDirectSpawn(browserBinaryLocation, chromiumConfig)
  }

  private async launchWithDirectSpawn(
    browserBinaryLocation: string,
    chromeFlags: string[]
  ) {
    console.log(messages.chromeInitializingEnhancedReload())

    const launchArgs = this.startingUrl
      ? [this.startingUrl, ...chromeFlags]
      : [...chromeFlags]

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'

    try {
      const child = spawn(`${browserBinaryLocation}`, launchArgs, {stdio})

      if (process.env.EXTENSION_ENV === 'development') {
        child.stdout?.pipe(process.stdout)
        child.stderr?.pipe(process.stderr)
      }

      child.on('close', (code: number | null) => {
        console.log(messages.chromeProcessExited(code || 0))
      })

      child.on('error', (error) => {
        console.error(messages.chromeProcessError(error))
      })
    } catch (error) {
      console.error(messages.chromeFailedToSpawn(error))
      throw error
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
      }, 2000)

      chromiumDidLaunch = true
      done()
    })
  }
}
