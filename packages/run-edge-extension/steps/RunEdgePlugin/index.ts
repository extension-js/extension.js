import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'
import {exec} from 'child_process'
import {bgCyan, bold, green, white, red} from '@colors/colors/safe'
// @ts-ignore
import edge from 'edge-location'
import browserConfig from './edge/browser.config'
import {type PluginOptions} from '../../types'

process.on('SIGINT', () => {
  process.exit()
})

process.on('SIGTERM', () => {
  process.exit()
})

export default class EdgeExtensionLauncherPlugin {
  private readonly options: PluginOptions

  constructor(options: PluginOptions) {
    this.options = options
  }

  private launchEdge() {
    const edgeLaunchPath = this.options.startingUrl
      ? `"${edge()}" "${this.options.startingUrl}"`
      : `"${edge()}"`

    if (!fs.existsSync(path.resolve(edge()))) {
      console.error(
        `${bgCyan(white(bold(` edge-runtime `)))} ${red(
          `✖︎✖︎✖︎`
        )} Edge not found at ${edge()}`
      )
      process.exit()
    }

    const edgeConfig = browserConfig(this.options)
    const cmd = `${edgeLaunchPath} ${edgeConfig}`

    const child = exec(cmd, (error, _stdout, stderr) => {
      if (error != null) throw error
      if (stderr.includes('Unable to move the cache')) {
        console.log(
          `${bgCyan(white(bold(` edge-runtime `)))} ${green(
            `►►►`
          )} Edge instance already running.`
        )
      } else {
        console.log(
          `${bgCyan(white(bold(` edge-runtime `)))} ${green(`►►►`)} Edge instance exited.`
        )
        process.exit()
      }
    })

    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
  }

  apply(compiler: Compiler) {
    let edgeDidLaunch = false
    compiler.hooks.afterEmit.tapAsync(
      'RunEdgeExtensionPlugin (EdgeExtensionLauncher)',
      (compilation, done) => {
        if (compilation.errors.length > 0) {
          done()
          return
        }

        if (edgeDidLaunch) {
          done()
          return
        }
        this.launchEdge()
        edgeDidLaunch = true
        done()
      }
    )
  }
}
