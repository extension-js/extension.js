// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {type Compiler} from 'webpack'

import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
// @ts-ignore
import CssUrlRelativePlugin from 'css-url-relative-plugin'

// import {type DevOptions} from '../../extensionDev'

export default function compilationPlugins() {
  return {
    name: 'CompilationPlugins',
    apply: (compiler: Compiler) => {
      new CaseSensitivePathsPlugin().apply(compiler)

      // Extracts imported CSS into separate files
      new MiniCssExtractPlugin().apply(compiler)

      // eslint-disable-next-line no-new
      // TODO: cezaraugusto ensure this works
      new CssUrlRelativePlugin(/* options */).apply(compiler)
    }
  }
}
