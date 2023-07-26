// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

// import path from 'path'
import type webpack from 'webpack'
import {type DevOptions} from '../../extensionDev'
// TODO: @cezaraugusto enable HMR support
// import ReactRefreshPlugin from '@pmmmwh/react-refresh-webpack-plugin'
// TODO: @cezaraugusto enable HMR support
// import ReloadPlugin from 'webpack-browser-extension-reload-plugin'

export default function reloadPlugins(projectPath: string, {mode}: DevOptions) {
  // const manifestPath = path.resolve(projectPath, 'manifest.json')

  return {
    name: 'reloadPlugins',
    apply: (compiler: webpack.Compiler) => {
      // if (mode !== 'development') return

      // TODO: @cezaraugusto enable HMR support
      // new webpack.HotModuleReplacementPlugin({}).apply(compiler)

      // Reload the browser when the extension is updated.
      // new ReloadPlugin({
      //   manifestPath,
      //   port: 8082
      // }).apply(compiler)
      // TODO: @cezaraugusto enable HMR support
      // React lib for hot-reloading.
      // new ReactRefreshPlugin().apply(compiler)
    }
  }
}
