import fs from 'fs'
import {exec} from 'child_process'
import {type Compiler} from 'webpack'
import {firefoxLocation} from './firefox-location'
import {browserConfig} from './firefox/browser-config'
import {RemoteFirefox} from './remote-firefox'
import * as messages from '../browsers-lib/messages'
import {type PluginInterface} from '../browsers-types'
import {DevOptions} from '../../commands/dev'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export class RunFirefoxPlugin {
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
    this.browser = options.browser || 'firefox'
    this.browserFlags = options.browserFlags || []
    this.userDataDir = options.userDataDir
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
  }

  private async launchFirefox(compiler: Compiler) {
    const firefoxLaunchPath = `fx-runner start --binary "${firefoxLocation}" --foreground --no-remote`

    if (!fs.existsSync(firefoxLocation!) || '') {
      console.error(
        messages.browserNotInstalled(this.browser, firefoxLocation!)
      )
      process.exit()
    }

    const firefoxConfig = await browserConfig(compiler, this)
    const cmd = `${firefoxLaunchPath} ${firefoxConfig}`

    const child = exec(cmd, (error, _stdout, stderr) => {
      if (error != null) throw error
      if (stderr.includes('Unable to move the cache')) {
        console.log(messages.browserInstanceAlreadyRunning(this.browser))
      } else {
        console.log(messages.browserInstanceExited(this.browser))
        process.exit()
      }
    })

    if (process.env.EXTENSION_ENV === 'development') {
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    }

    // Inject the add-ons code into Firefox profile.
    const remoteFirefox = new RemoteFirefox(this)

    try {
      await remoteFirefox.installAddons(compiler)
    } catch (error) {
      const strErr = error?.toString()
      if (strErr?.includes('background.service_worker is currently disabled')) {
        console.error(messages.firefoxServiceWorkerError(this.browser))
        process.exit(1)
      }

      console.error(messages.errorLaunchingBrowser(this.browser, error))
      process.exit(1)
    }
  }

  apply(compiler: Compiler) {
    let firefoxDidLaunch = false

    compiler.hooks.done.tapAsync(
      'run-chromium:module',
      async (compilation, done) => {
        if (compilation.compilation.errors.length > 0) {
          done()
          return
        }

        if (firefoxDidLaunch) {
          done()
          return
        }

        await this.launchFirefox(compiler)

        console.log(
          messages.stdoutData(
            // extensionManifest.name,
            this.browser,
            compilation.compilation.options.mode
          )
        )
        firefoxDidLaunch = true
        done()
      }
    )
  }
}
