// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import webpack, {Compiler} from 'webpack'

import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
// @ts-ignore
import CssUrlRelativePlugin from 'css-url-relative-plugin'
// import Dotenv from 'dotenv-webpack'

import {type DevOptions} from '../../extensionDev'

export default function compilationPlugins(
  projectPath: string,
  {mode}: DevOptions
) {
  return {
    name: 'CompilationPlugins',
    apply: (compiler: webpack.Compiler) => {
      new CaseSensitivePathsPlugin().apply(compiler)

      // Extracts imported CSS into separate files
      new MiniCssExtractPlugin().apply(compiler)

      new CssUrlRelativePlugin(/* options */)

      // Support .env files
      // TODO: cezaraugusto this has a type errors
      // if (fs.existsSync(path.join(projectPath, '.env'))) {
      //   new Dotenv().apply(compiler)
      // }

      // Support environment variables
      new webpack.EnvironmentPlugin({
        EXTENSION_ENV: process.env.EXTENSION_ENV || mode,
        EXTENSION_PUBLIC_PATH: path.join(projectPath, '/')
      }).apply(compiler)
    }
  }
}
