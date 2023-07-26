// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import webpack from 'webpack'

import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
// import ForkTsCheckerWarningWebpackPlugin from './fork-ts-checker-warning-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import Dotenv from 'dotenv-webpack'

// Checks
// import {isUsingTypeScript} from '../options/typescript'
import {type DevOptions} from '../../extensionDev'

export default function compilationPlugins(
  projectPath: string,
  {mode}: DevOptions
) {
  return {
    name: 'compilationPlugins',
    apply: (compiler: webpack.Compiler) => {
      // new ESLintPlugin().apply(compiler)

      new CaseSensitivePathsPlugin().apply(compiler)

      // Parse TypeScript files in a different process if needed
      // TODO: cezaraugusto this makes the reload plugin to run twice
      // if (isUsingTypeScript(projectPath)) {
      //   new ForkTsCheckerWarningWebpackPlugin().apply(compiler)
      // }

      // Extracts imported CSS into separate files
      new MiniCssExtractPlugin().apply(compiler)

      // Support .env files
      if (fs.existsSync(path.join(projectPath, '.env'))) {
        new Dotenv().apply(compiler)
      }

      // Support environment variables
      new webpack.EnvironmentPlugin({
        EXTENSION_ENV: process.env.EXTENSION_ENV || mode,
        EXTENSION_PUBLIC_PATH: path.join(projectPath, '/')
      }).apply(compiler)
    }
  }
}
