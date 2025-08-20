// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {type Compiler} from '@rspack/core'
import {PluginInterface} from '../webpack-types'
import {PolyfillPlugin} from './feature-polyfill'
import {BrowserSpecificFieldsPlugin} from './feature-browser-specific-fields'
import {type DevOptions} from '../../develop-lib/config-types'

export class CompatibilityPlugin {
  public static readonly name: string = 'plugin-compatibility'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly polyfill: DevOptions['polyfill']

  constructor(options: PluginInterface & {polyfill: DevOptions['polyfill']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.polyfill = options.polyfill || false
  }

  public async apply(compiler: Compiler) {
    // Allow browser polyfill as needed
    if (this.polyfill) {
      if (this.browser !== 'firefox') {
        new PolyfillPlugin({
          manifestPath: this.manifestPath,
          browser: this.browser || 'chrome'
        }).apply(compiler)
      }
    }

    // Handle manifest compatibilities across browser vendors.
    new BrowserSpecificFieldsPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)
  }
}
