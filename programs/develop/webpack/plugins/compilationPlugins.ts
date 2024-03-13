// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {type Compiler} from 'webpack'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'

import {type DevOptions} from '../../extensionDev'
import {isUsingTypeScript, tsCheckerOptions} from '../options/typescript'

export default function compilationPlugins(
  projectDir: string,
  opts: DevOptions
) {
  return {
    name: 'CompilationPlugins',
    apply: (compiler: Compiler) => {
      new CaseSensitivePathsPlugin().apply(compiler)

      if (isUsingTypeScript(projectDir)) {
        const options = tsCheckerOptions(projectDir, opts)
        new ForkTsCheckerWebpackPlugin(options).apply(compiler)
      }
    }
  }
}
