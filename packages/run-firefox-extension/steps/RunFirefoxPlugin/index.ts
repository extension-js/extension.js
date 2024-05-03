import fs from 'fs'
import {type Compiler} from 'webpack'
import {exec} from 'child_process'
import {bgWhite, black, green, red, blue} from '@colors/colors/safe'
// @ts-ignore
import firefox from 'firefox-location'
import browserConfig from './firefox/browser.config'
import {type PluginOptions} from '../../types'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export default class FirefoxExtensionLauncherPlugin {
  private readonly options: PluginOptions

  constructor(options: PluginOptions) {
    this.options = options
  }

  private launchFirefox() {
    const profilePath = browserConfig(this.options).path()
    const startingUrl = this.options.startingUrl || 'about:blank'
    const firefoxLaunchPath = `"${firefox}" -profile "${profilePath}" -no-remote --url "${startingUrl}"`

    if (!fs.existsSync(firefox as string)) {
      console.error(
        `${bgWhite(black(` firefox-browser `))} ${red(`✖︎✖︎✖︎`)} ` +
          `Firefox browser ${
            typeof firefox === 'undefined'
              ? 'is not installed.'
              : `is not found at ${firefox}`
          }. ` +
          `Either install Firefox or choose a different browser via ${blue(
            '--browser'
          )}.`
      )
      process.exit()
    }

    const cmd = `${firefoxLaunchPath}`

    const child = exec(cmd, (error, _stdout, stderr) => {
      if (error != null) throw error
      if (stderr.includes('Unable to move the cache')) {
        console.log(
          `${bgWhite(black(` firefox-browser `))} ${green(
            `►►►`
          )} Firefox instance already running.`
        )
      } else {
        console.log(
          `${bgWhite(black(` firefox-browser `))} ${green(
            `►►►`
          )} Firefox instance exited.`
        )
        process.exit()
      }
    })

    if (process.env.EXTENSION_ENV === 'development') {
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    }
  }

  apply(compiler: Compiler) {
    let firefoxDidLaunch = false
    compiler.hooks.afterEmit.tapAsync(
      'RunFirefoxExtensionPlugin (FirefoxExtensionLauncher)',
      (compilation, done) => {
        if (compilation.errors.length > 0) {
          done()
          return
        }

        if (firefoxDidLaunch) {
          done()
          return
        }
        this.launchFirefox()
        firefoxDidLaunch = true
        done()
      }
    )
  }
}
