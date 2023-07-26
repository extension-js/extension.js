// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {babelConfig} from '../options/babel'
import {isUsingTypeScript} from '../options/typescript'
import ReactRefreshTypeScript from 'react-refresh-typescript'

export default function jsLoaders(projectDir: string, opts: any) {
  // Prevent users from running ts/tsx files when not using TypeScript
  const files = isUsingTypeScript(projectDir)
    ? /\.(js|mjs|jsx|ts|tsx)$/
    : /\.(js|mjs|jsx)$/

  return [
    {
      test: files,
      include: projectDir,
      exclude: /node_modules/,
      loader: require.resolve('babel-loader'),
      options: babelConfig(projectDir, {
        mode: opts.mode,
        typescript: isUsingTypeScript(projectDir)
      })
    },
    {
      test: /\.tsx?$/,
      use: {
        loader: require.resolve('ts-loader'),
        options: {
          transpileOnly: true,
          getCustomTransformers: () => ({
            before: [
              opts.mode === 'development' && ReactRefreshTypeScript()
            ].filter(Boolean)
          })
        }
      }
    }
  ]
}
