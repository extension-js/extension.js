// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {babelConfig} from '../options/babel'
import {isUsingTypeScript} from '../options/typescript'
import {isUsingVue} from '../options/vue'

type Loader = Record<string, any>

const vueLoaders = (projectPath: string): Loader[] => {
  const vueLoaders: Loader[] = [
    {
      test: /\.vue$/,
      loader: require.resolve('vue-loader')
    }
  ]

  // use vue and typescript, need to add ts-loader
  if (isUsingTypeScript(projectPath)) {
    vueLoaders.push({
      test: /\.ts?$/,
      loader: require.resolve('ts-loader'),
      options: {
        appendTsSuffixTo: [/\.vue$/],
        // Skip type checking
        transpileOnly: true
      }
    })
  }
  return vueLoaders
}

export default function jsLoaders(projectPath: string, opts: any) {
  // Prevent users from running ts/tsx files when not using TypeScript
  const files = isUsingTypeScript(projectPath)
    ? /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/
    : /\.(js|mjs|jsx|mjsx)$/

  const jsLoaders: Loader[] = [
    // https://webpack.js.org/loaders/babel-loader/
    // https://babeljs.io/docs/en/babel-loader
    {
      test: files,
      include: projectPath,
      exclude: /node_modules/,
      loader: require.resolve('babel-loader'),
      options: babelConfig(projectPath, {
        mode: opts.mode,
        typescript: isUsingTypeScript(projectPath)
      })
    }
  ]

  // Add vue-loader when using vue
  isUsingVue(projectPath) && jsLoaders.push(...vueLoaders(projectPath))

  return jsLoaders
}
