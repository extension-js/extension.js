// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {Compiler} from '@rspack/core'
import * as messages from '../../lib/messages'
import {DevOptions} from '../../../commands/commands-lib/config-types'
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

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

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
      if (process.env.EXTENSION_ENV === 'development') {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.isUsingIntegration('Babel'))
        }
      }

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
    compact: opts.mode === 'production'
  }
}

export async function maybeUseBabel(
  _compiler: Compiler,
  projectPath: string
): Promise<JsFramework | undefined> {
  isUsingBabel(projectPath)

  return undefined
}
