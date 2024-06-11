import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'
import {spawn} from 'child_process'
import {bgCyan, bold, white, red, blue} from '@colors/colors/safe'
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
    const msEdge: string = edge()

    if (!fs.existsSync(path.resolve(msEdge))) {
      console.error(
        `${bgCyan(white(bold(` edge-browser `)))} ${red(
          `✖︎✖︎✖︎`
        )} Edge not found at ${msEdge}`
      )
      process.exit()
    }

    if (!fs.existsSync(msEdge) || '') {
      console.error(
        `${bgCyan(white(bold(` edge-browser `)))} ${red(`✖︎✖︎✖︎`)} ` +
          `Edge browser ${typeof msEdge === 'undefined' ? 'is not installed.' : `is not found at ${msEdge}`}. ` +
          // `Either install Edge or set the EDGE environment variable to the path of the Edge executable.`
          `Either install Edge or choose a different browser via ${blue('--browser')}.`
      )
      process.exit()
    }

    const edgeConfig = browserConfig(this.options)
    const launchArgs = [this.options.startingUrl || '', ...edgeConfig]
    const child = spawn(msEdge, launchArgs, {stdio: 'inherit'})

    if (process.env.EXTENSION_ENV === 'development') {
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    }
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
