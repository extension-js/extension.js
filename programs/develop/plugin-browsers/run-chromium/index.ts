import fs from 'fs'
import {type Compiler} from 'webpack'
import {spawn} from 'child_process'
import {bgWhite, bold, black, red, blue} from '@colors/colors/safe'
import {browserConfig} from './browser-config'
import {PluginInterface} from '../types'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export class RunChromiumPlugin {
  public readonly extension: string | string[]
  public readonly browser: string
  public readonly port?: number
  public readonly browserFlags?: string[]
  public readonly userDataDir?: string
  public readonly profile?: string
  public readonly preferences?: string
  public readonly startingUrl?: string
  public readonly autoReload?: boolean
  public readonly stats?: boolean

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser || 'chrome'
    this.browserFlags = options.browserFlags || []
    this.userDataDir = options.userDataDir
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
  }

  private browserNameCapitalized(browser: string) {
    return browser.charAt(0).toUpperCase() + this.browser.slice(1)
  }

  private launchChromium(compiler: Compiler, browser: string) {
    const browserBinaryLocation: string = require(`${browser}-location`)

    if (!fs.existsSync(browserBinaryLocation) || '') {
      console.error(
        `${bgWhite(black(bold(` ${browser}-browser `)))} ${red('✖︎✖︎✖︎')} ` +
          `{browser} browser ${
            typeof browserBinaryLocation === 'undefined'
              ? 'is not installed.'
              : `is not found at ${browserBinaryLocation}`
          }. ` +
          `Either install ${this.browserNameCapitalized(
            browser
          )} or choose a different browser via ${blue('--browser')}.`
      )
      process.exit()
    }

    const chromiumConfig = browserConfig(compiler, this)
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

    compiler.hooks.done.tapAsync('run-chromium:module', (compilation, done) => {
      if (compilation.hasErrors.length > 0) {
        done()
        return
      }

      if (chromiumDidLaunch) {
        done()
        return
      }

      this.launchChromium(compiler, this.browser)
      chromiumDidLaunch = true
      done()
    })
  }
}
