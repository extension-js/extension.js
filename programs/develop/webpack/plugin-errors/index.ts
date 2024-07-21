// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import type webpack from 'webpack'
import CommonErrorsPlugin from 'webpack-browser-extension-common-errors'
import {type DevOptions} from '../../types'

export default function errorPlugins(
  projectPath: string,
  {mode, browser}: DevOptions
) {
  return {
    constructor: {name: 'ErrorPlugin'},
    apply: (compiler: webpack.Compiler) => {
      const manifestPath = path.resolve(projectPath, 'manifest.json')

      // TODO: combine all extension context errors into one.
      // new CombinedErrorsPlugin().apply(compiler)

      // TODO: Combine common config errors and output a nice error display.
      // new ErrorLayerPlugin().apply(compiler)

      // Handle common user mistakes and webpack errors.
      new CommonErrorsPlugin({
        manifestPath
      }).apply(compiler)
    }
  }
}
