// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type webpack from 'webpack'
import {type DevOptions} from '../../extensionDev'
import ReactRefreshPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import {isUsingReact} from '../options/react'

export default function reloadPlugins(projectPath: string, {mode}: DevOptions) {
  return {
    name: 'reloadPlugins',
    apply: (compiler: webpack.Compiler) => {
      if (mode !== 'development') return

      if (isUsingReact(projectPath)) {
        new ReactRefreshPlugin().apply(compiler)
      }
    }
  }
}
