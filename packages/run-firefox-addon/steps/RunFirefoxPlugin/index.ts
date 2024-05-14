import fs from 'fs'
import {exec} from 'child_process'
import {bgWhite, green, red, bold, blue} from '@colors/colors/safe'
import {type Compiler} from 'webpack'
// @ts-ignore
import firefox from 'firefox-location'
import {type RunFirefoxExtensionInterface} from '../../types'
import browserConfig from './firefox/browser.config'
import RemoteFirefox from './remoteFirefox'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export default class FirefoxExtensionLauncherPlugin {
  private readonly options: RunFirefoxExtensionInterface

  constructor(options: RunFirefoxExtensionInterface) {
    this.options = options
  }

  private async launchFirefox() {
    const firefoxLaunchPath = `fx-runner start --binary "${firefox}" --foreground --no-remote`

    if (!fs.existsSync(firefox as string) || '') {
      console.error(
        `${bgWhite(red(` firefox-browser `))} ${red(`✖︎✖︎✖︎`)} ` +
          `Firefox browser ${typeof firefox === 'undefined' ? 'is not installed.' : `is not found at ${firefox}`}. ` +
          // `Either install Firefox or set the FIREFOX environment variable to the path of the Firefox executable.`
          `Either install Firefox or choose a different browser via ${blue('--browser')}.`
      )
      process.exit()
    }

    const firefoxConfig = await browserConfig(this.options)
    const cmd = `${firefoxLaunchPath} ${firefoxConfig}`

    // Inject the add-ons code into Firefox profile.
    new RemoteFirefox(this.options).installAddons()

    const child = exec(cmd, (error, _stdout, stderr) => {
      if (error != null) throw error
      if (stderr.includes('Unable to move the cache')) {
        console.log(
          `${bgWhite(red(bold(` firefox-browser `)))} ${green(
            `►►►`
          )} Firefox instance already running.`
        )
      } else {
        console.log(
          `${bgWhite(red(bold(` firefox-browser `)))} ${green(
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
