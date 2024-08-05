// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {Compiler} from 'webpack'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {isUsingReact} from './react'
import {isUsingPreact} from './preact'
import {DevOptions} from '../../../commands/dev'
import {isUsingTypeScript, maybeUseTypeScript} from './typescript'
import {JsFramework} from '../../webpack-types'

let userMessageDelivered = false

const babelConfigFiles = [
  '.babelrc',
  '.babelrc.json',
  '.babelrc.js',
  '.babelrc.cjs',
  'babel.config.json',
  'babel.config.js',
  'babel.config.cjs'
]

export function isUsingBabel(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)

  const babelAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies['babel-core']

  const babelAsDep =
    packageJson.dependencies && packageJson.dependencies['babel-core']

  const isUsingBabel =
    babelConfigFiles.some((file) =>
      fs.existsSync(path.join(projectPath, file))
    ) ||
    !!babelAsDevDep ||
    !!babelAsDep

  if (isUsingBabel) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(messages.isUsingTechnology(manifest, 'Babel'))

      userMessageDelivered = true
    }
  }

  return isUsingBabel
}

export function getBabelConfigFile(projectPath: string) {
  for (const file of babelConfigFiles) {
    const configFile = path.join(projectPath, file)

    if (fs.existsSync(configFile)) {
      return configFile
    }
  }

  return undefined
}

export function babelConfig(
  projectPath: string,
  opts: {
    mode: DevOptions['mode']
    typescript: boolean
  }
) {
  const presetModernExtensions =
    require('babel-preset-modern-browser-extension').default

  return {
    // When set, the given directory will be used to cache the results
    // of the loader. Future webpack builds will attempt to read from
    // the cache to avoid needing to run the potentially expensive Babel
    // recompilation process on each run. If the value is set to true in
    // options ({cacheDirectory: true}), the loader will use the default
    // cache directory in node_modules/.cache/babel-loader or fallback to
    // the default OS temporary file directory if no node_modules folder
    // could be found in any root directory.
    cacheDirectory: false,
    // When set, each Babel transform output will be compressed with Gzip.
    // If you want to opt-out of cache compression, set it to false -- your
    // project may benefit from this if it transpiles thousands of files.
    cacheCompression: false,
    babelrc: false,
    configFile: getBabelConfigFile(projectPath),
    compact: opts.mode === 'production',
    overrides: [presetModernExtensions(opts).overrides],
    presets: [...presetModernExtensions(opts).presets],
    plugins: [
      ...presetModernExtensions(opts).plugins,
      process.env.NODE_ENV !== 'test' &&
        opts.mode === 'development' &&
        (isUsingReact(projectPath) || isUsingPreact(projectPath)) &&
        require.resolve('react-refresh/babel')
    ].filter(Boolean)
  }
}

export async function maybeUseBabel(
  compiler: Compiler,
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingBabel(projectPath)) return undefined

  try {
    require.resolve('babel-loader')
  } catch (e) {
    const babelDependencies = [
      '@babel/core',
      'babel-loader',
      'babel-preset-modern-browser-extension'
    ]

    await installOptionalDependencies('Babel', babelDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Babel'))
    process.exit(0)
  }

  // Prevent users from running ts/tsx files when not using TypeScript
  const files = isUsingTypeScript(projectPath)
    ? /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/
    : /\.(js|mjs|jsx|mjsx)$/

  const mode = compiler.options.mode
  const maybeInstallTypeScript = await maybeUseTypeScript(projectPath)

  return {
    plugins: undefined,
    loaders: [
      // https://webpack.js.org/loaders/babel-loader/
      // https://babeljs.io/docs/en/babel-loader
      {
        test: files,
        include: projectPath,
        exclude: /node_modules/,
        loader: require.resolve('babel-loader'),
        options: babelConfig(projectPath, {
          mode,
          typescript: maybeInstallTypeScript
        })
      }
    ],
    alias: undefined
  }
}
