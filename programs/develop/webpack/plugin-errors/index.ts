// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {Compiler} from 'webpack'
import {type PluginInterface} from '../webpack-types'
import {DevOptions} from '../../commands/dev'
import {ManifestRuntimeErrorsPlugin} from './manifest-runtime-errors'
import {ManifestSchemaErrorsPlugin} from './manifest-schema-errors'
import {WebpackCommonErrorsPlugin} from './webpack-common-errors'

export class ErrorsPlugin {
  public static readonly name: string = 'plugin-errors'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    // TODO: Combine common config errors and output a nice error display.
    // new ErrorLayerPlugin().apply(compiler)

    new ManifestRuntimeErrorsPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)

    new ManifestSchemaErrorsPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)

    // Handle common user mistakes and webpack errors.
    new WebpackCommonErrorsPlugin({
      manifestPath: this.manifestPath
    }).apply(compiler)
  }
}
