// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import {PathData, type Compiler} from 'webpack'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import StylelintPlugin from 'stylelint-webpack-plugin'

import MiniCssExtractPlugin from 'mini-css-extract-plugin'

import {type DevOptions} from '../../extensionDev'
import {isUsingTypeScript, tsCheckerOptions} from '../options/typescript'
import {isUsingStylelint} from '../options/stylelint'
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
        configFile: isUsingStylelint(projectDir)
          ? getStylelintConfigFile(projectDir)
          : path.join(__dirname, 'stylelint.config.js'),
        files: '**/*.{css,scss,sass,less}',
        exclude: ['node_modules', path.join(projectDir, 'node_modules')]
        // TODO: cezaraugusto evaluate
        // failOnWarning: true
      }).apply(compiler)

      if (opts.mode === 'production') {
        new MiniCssExtractPlugin({
          chunkFilename: (pathData: PathData) => {
            const runtime = (pathData.chunk as any)?.runtime

            // Chunks are stored within their caller's directory,
            // but assets imported in content_scripts must be set
            // as a web_accessible_resource, so the dynamic import
            // of a CSS content_script will be stored as
            // web_accessible_resource/resource-{index}/[name].css.
            if (runtime.startsWith('content_scripts')) {
              const [, contentName] = runtime.split('/')
              const index = contentName.split('-')[1]

              return `web_accessible_resources/resource-${index}/[name].css`
            }

            // Chunks are stored within their caller's directory,
            // So a dynamic import of a CSS action page will be stored
            // as action/[filename]_.css.
            // The JS counterpart of this is defined in webpack-config's
            // options.chunkFilename function.
            return `${runtime}/[name].css`
          }
        }).apply(compiler)
      }
    }
  }
}
