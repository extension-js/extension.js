// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {type Compiler} from 'webpack'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import StylelintPlugin from 'stylelint-webpack-plugin'

import MiniCssExtractPlugin from 'mini-css-extract-plugin'

import {type DevOptions} from '../../extensionDev'
import {isUsingTypeScript, tsCheckerOptions} from '../options/typescript'
import {isUsingTailwind} from '../options/tailwind'
import {getStylelintConfigFile} from '../options/stylelint'

export default function compilationPlugins(
  projectDir: string,
  opts: DevOptions
) {
  return {
    constructor: {name: 'CompilationPlugins'},
    apply: (compiler: Compiler) => {
      new CaseSensitivePathsPlugin().apply(compiler)

      if (isUsingTypeScript(projectDir)) {
        const options = tsCheckerOptions(projectDir, opts)
        new ForkTsCheckerWebpackPlugin(options).apply(compiler)
      }

      new StylelintPlugin({
        context: projectDir,
        configFile: isUsingTailwind(projectDir)
          ? getStylelintConfigFile(projectDir)
          : path.join(__dirname, 'stylelint.config.js'),
        files: '**/*.{css,scss,sass,less}',
        exclude: ['node_modules', path.join(projectDir, 'node_modules')]
        // TODO: cezaraugusto evaluate
        // failOnWarning: true
      }).apply(compiler)

      // new MiniCssExtractPlugin().apply(compiler)
    }
  }
}
