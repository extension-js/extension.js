// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

// From:
// https://github.com/TypeStrong/fork-ts-checker-webpack-plugin/issues/232#issuecomment-645543747
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import type {Compiler} from 'webpack'

export default class ForkTsCheckerWarningWebpackPlugin {
  public apply(compiler: Compiler) {
    new ForkTsCheckerWebpackPlugin().apply(compiler)

    const hooks = ForkTsCheckerWebpackPlugin.getCompilerHooks(compiler)

    hooks.issues.tap('ForkTsCheckerWarningWebpackPlugin', (issues) =>
      issues.map((issue) => ({...issue, severity: 'warning'}))
    )
  }
}
