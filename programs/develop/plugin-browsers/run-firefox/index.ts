import * as fs from 'fs'
import * as path from 'path'
import {exec, ChildProcess} from 'child_process'
import {type Compiler} from '@rspack/core'
import firefoxLocation from 'firefox-location2'
import {browserConfig} from './firefox/browser-config'
import {RemoteFirefox} from './remote-firefox'
import * as messages from '../browsers-lib/messages'
import {type PluginInterface} from '../browsers-types'
import {
  BrowserConfig,
  DevOptions
} from '../../commands/commands-lib/config-types'
import {isFromPnpx} from '../../webpack/lib/utils'

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

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser || 'firefox'
    this.browserFlags = options.browserFlags || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
    this.geckoBinary = options.geckoBinary
  }

  private async getFxRunnerCommand() {
    const globalNpxPath = isFromPnpx()
      ? 'pnpm dlx fx-runner'
      : 'npm exec fx-runner'

    try {
      // Try executing npx -y fx-runner to see if it is available globally
      await new Promise((resolve, reject) => {
        exec(`${globalNpxPath} --version`, (err) => {
          if (err) reject(err)
          else resolve(null)
        })
      })
      return globalNpxPath
    } catch (error) {
      console.error(messages.browserNotInstalledError('firefox', globalNpxPath))
      process.exit(1)
    }
  }

  private async launchFirefox(
    compiler: Compiler,
    options: DevOptions & BrowserConfig
  ) {
    const fxRunnerCmd = await this.getFxRunnerCommand()

    let browserBinaryLocation: string | null = null

    switch (options.browser) {
      case 'gecko-based':
        browserBinaryLocation = path.normalize(this.geckoBinary!)
        break

      default:
        browserBinaryLocation = firefoxLocation()
        break
    }

    const firefoxLaunchPath = `${fxRunnerCmd} start --binary "${browserBinaryLocation}" --foreground --no-remote`

    if (!fs.existsSync(browserBinaryLocation || '')) {
      console.error(
        messages.browserNotInstalledError(
          this.browser,
          browserBinaryLocation || ''
        )
      )
      process.exit(1)
    }

    const firefoxConfig = await browserConfig(compiler, options)
    const cmd = `${firefoxLaunchPath} ${firefoxConfig}`

    child = exec(cmd, (error, _stdout, stderr) => {
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

      console.error(messages.browserLaunchError(this.browser, error))
      process.exit(1)
    }
  }

  apply(compiler: Compiler) {
    let firefoxDidLaunch = false

    compiler.hooks.done.tapAsync('run-firefox:module', async (stats, done) => {
      if (stats.compilation.errors.length > 0) {
        done()
        return
      }

      if (firefoxDidLaunch) {
        done()
        return
      }

      setTimeout(() => {
        console.log(
          messages.stdoutData(
            this.browser,
            stats.compilation.options.mode as DevOptions['mode']
          )
        )
      }, 2000)

      await this.launchFirefox(compiler, {
        browser: this.browser,
        browserFlags: this.browserFlags,
        profile: this.profile,
        preferences: this.preferences,
        startingUrl: this.startingUrl,
        mode: stats.compilation.options.mode as DevOptions['mode']
      })

      firefoxDidLaunch = true
      done()
    })
  }
}
