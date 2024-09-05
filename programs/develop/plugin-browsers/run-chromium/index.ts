import fs from 'fs'
import {type Compiler} from 'webpack'
import {spawn} from 'child_process'
import {browserConfig} from './browser-config'
import * as messages from '../browsers-lib/messages'
import {PluginInterface} from '../browsers-types'
import {DevOptions} from '../../commands/dev'

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
  public readonly userDataDir?: string
  public readonly profile?: string
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string
  public readonly autoReload?: boolean
  public readonly stats?: boolean

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser
    this.browserFlags = options.browserFlags || []
    this.userDataDir = options.userDataDir
    this.profile = options.profile || options.userDataDir
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
  }

  private launchChromium(browser: DevOptions['browser']) {
    let browserBinaryLocation: string

    switch (browser) {
      case 'chrome':
        browserBinaryLocation = require(`${browser}-location`)
        break

      case 'edge':
        browserBinaryLocation = require(`${browser}-location`)()
        break

      default:
        browserBinaryLocation = require(`${browser}`)
        break
    }
    if (!fs.existsSync(browserBinaryLocation) || '') {
      console.error(
        messages.browserNotInstalledError(browser, browserBinaryLocation)
      )
      process.exit()
    }

    const chromiumConfig = browserConfig(this)
    const launchArgs = this.startingUrl
      ? [this.startingUrl, ...chromiumConfig]
      : [...chromiumConfig]

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const child = spawn(browserBinaryLocation, launchArgs, {stdio})

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

      this.launchChromium(this.browser)

      setTimeout(() => {
        console.log(
          messages.stdoutData(
            this.browser,
            compilation.compilation.options.mode
          )
        )
      }, 2000)

      chromiumDidLaunch = true
      done()
    })
  }
}
