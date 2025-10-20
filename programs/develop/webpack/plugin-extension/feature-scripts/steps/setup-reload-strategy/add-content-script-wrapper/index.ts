import {type Compiler} from '@rspack/core'
import {type PluginInterface} from '../../../../../webpack-types'
import {type DevOptions} from '../../../../../../develop-lib/config-types'
import * as path from 'path'

export class AddContentScriptWrapper {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler) {
    // 1- Add the content script wrapper. webpack-target-webextension
    // needs mounting and internal HMR code to work. This plugin abstracts
    // this away from the user. The contract requires the user to export a
    // default function that returns an optional cleanup function.
    compiler.options.module.rules.push({
      test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [path.dirname(this.manifestPath)],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: path.resolve(__dirname, 'content-script-wrapper'),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        }
      ]
    })

    // 2- The wrapper above requires a default export.
    // This loader will warn if the script does not have a default export.
    compiler.options.module.rules.push({
      test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [path.dirname(this.manifestPath)],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: path.resolve(__dirname, 'warn-no-default-export'),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        }
      ]
    })

    // 3- Inject minimal HMR accept code for declared background and user scripts
    compiler.options.module.rules.push({
      test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [path.dirname(this.manifestPath)],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: path.resolve(__dirname, 'add-hmr-accept-code'),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        }
      ]
    })
  }
}
