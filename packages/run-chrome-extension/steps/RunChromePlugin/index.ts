import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'
import {spawn} from 'child_process'
import {bgWhite, bold, black, red, blue} from '@colors/colors/safe'
// @ts-ignore
import chromeLocation from 'chrome-location'
import browserConfig from './chrome/browser.config'
import {type PluginOptions} from '../../types'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export default class ChromeExtensionLauncherPlugin {
  private readonly options: PluginOptions

  constructor(options: PluginOptions) {
    this.options = options
  }

  private launchChrome() {
    const chrome: string = chromeLocation
    if (!fs.existsSync(path.resolve(chrome))) {
      console.error(
        `${bgWhite(black(bold(` chrome-browser `)))} ${red(
          '✖︎✖︎✖︎'
        )} Chrome not found at ${chrome}`
      )
      process.exit()
    }

    if (!fs.existsSync(chrome) || '') {
      console.error(
        `${bgWhite(black(bold(` chrome-browser `)))} ${red('✖︎✖︎✖︎')} ` +
          `Chrome browser ${
            typeof chrome === 'undefined'
              ? 'is not installed.'
              : `is not found at ${chrome}`
          }. ` +
          // `Either install Chrome or set the Chrome environment variable to the path of the Chrome executable.`
          `Either install Chrome or choose a different browser via ${blue(
            '--browser'
          )}.`
      )
      process.exit()
    }

    const chromeConfig = browserConfig(this.options)
    const launchArgs = [this.options.startingUrl || '', ...chromeConfig]

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const child = spawn(chrome, launchArgs, {stdio})

    if (process.env.EXTENSION_ENV === 'development') {
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    }
  }

  apply(compiler: Compiler) {
    let chromeDidLaunch = false
    compiler.hooks.afterEmit.tapAsync(
      'RunChromeExtensionPlugin (ChromeExtensionLauncher)',
      (compilation, done) => {
        if (compilation.errors.length > 0) {
          done()
          return
        }

        if (chromeDidLaunch) {
          done()
          return
        }
        this.launchChrome()
        chromeDidLaunch = true
        done()
      }
    )
  }
}
