// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {babelConfig} from '../options/babel'
import {isUsingTypeScript} from '../options/typescript'

export default function jsLoaders(projectDir: string, opts: any) {
  // Prevent users from running ts/tsx files when not using TypeScript
  const files = isUsingTypeScript(projectDir)
    ? /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/
    : /\.(js|mjs|jsx|mjsx)$/

  const jsLoaders = [
    // https://webpack.js.org/loaders/babel-loader/
    // https://babeljs.io/docs/en/babel-loader
    {
      test: files,
      include: projectDir,
      exclude: /node_modules/,
      loader: require.resolve('babel-loader'),
      options: babelConfig(projectDir, {
        mode: opts.mode,
        typescript: isUsingTypeScript(projectDir)
      })
    }
  ]

  return jsLoaders
}
