// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

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
      use: {
        loader: require.resolve('swc-loader'),
        options: {
          env: {
            targets: `browserslist config or defaults`
          },
          minify: opts.mode === 'production'
        }
      }
    },
    // https://webpack.js.org/loaders/ts-loader/
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
