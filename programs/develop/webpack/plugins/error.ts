// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type webpack from 'webpack'
// import CommonErrorsPlugin from 'webpack-common-errors-plugin'
import {type DevOptions} from '../../extensionDev'

export default function errorPlugins(projectPath: string, {mode}: DevOptions) {
  return {
    name: 'errorPlugins',
    apply: (compiler: webpack.Compiler) => {
      // TODO: combine all extension context errors into one.
      // new CombinedErrorsPlugin().apply(compiler)
      // TODO: Handle common config errors and output a nice error display.
      // new ErrorLayerPlugin().apply(compiler)
      // TODO: Handle manifest compatibilities across browser vendors.
      // new ManifestCompatPlugin().apply(compiler)
      // TODO: Handle common webpack errors.
      // new CommonErrorsPlugin().apply(compiler)
    }
  }
}
