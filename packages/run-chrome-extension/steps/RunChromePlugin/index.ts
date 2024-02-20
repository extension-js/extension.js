import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'
import {exec} from 'child_process'
import {bgWhite, black, green} from '@colors/colors/safe'
// @ts-ignore
import chrome from 'chrome-location'
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
    const chromeLaunchPath = this.options.startingUrl
      ? `"${chrome}" "${this.options.startingUrl}"`
      : `"${chrome}"`

    if (!fs.existsSync(path.resolve(chrome))) {
      console.error(
        `${bgWhite(black(`chrome-runtime`))} ${green(
          `►►►`
        )} Chrome not found at ${chrome}`
      )
      process.exit()
    }

    const chromeConfig = browserConfig(this.options)
    const cmd = `${chromeLaunchPath} ${chromeConfig}`

    const child = exec(cmd, (error, _stdout, stderr) => {
      if (error != null) throw error
      if (stderr.includes('Unable to move the cache')) {
        console.log(
          `${bgWhite(black(`chrome-runtime`))} ${green(
            `►►►`
          )} Chrome instance already running.`
        )
      } else {
        console.log(
          `${bgWhite(black(`chrome-runtime`))} ${green(`►►►`)} Chrome instance exited.`
        )
        process.exit()
      }
    })

    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
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
