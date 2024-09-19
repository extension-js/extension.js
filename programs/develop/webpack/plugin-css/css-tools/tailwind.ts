// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'

let userMessageDelivered = false

export function isUsingTailwind(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getTailwindConfigFile(projectPath)
  const packageJson = require(packageJsonPath)

  const tailwindAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.tailwindcss

  const tailwindAsDep =
    packageJson.dependencies && packageJson.dependencies.tailwindcss

  const isUsingTailwind = !!configFile && !!(tailwindAsDevDep || tailwindAsDep)

  if (isUsingTailwind) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('Tailwind'))
      }
      userMessageDelivered = true
    }
  }

  return isUsingTailwind
}

export function getTailwindConfigFile(projectPath: string) {
  const configFileMjs = path.join(projectPath, 'tailwind.config.mjs')
  const configFileCjs = path.join(projectPath, 'tailwind.config.cjs')
  const configFileJs = path.join(projectPath, 'tailwind.config.js')

  if (fs.existsSync(configFileMjs)) return configFileMjs
  if (fs.existsSync(configFileCjs)) return configFileCjs
  if (fs.existsSync(configFileJs)) return configFileJs

  return undefined
}

export async function maybeUseTailwind(projectPath: string) {
  if (!isUsingTailwind(projectPath)) return []
  try {
    require.resolve('tailwindcss')
  } catch (e) {
    const postCssDependencies = [
      'postcss-loader',
      'postcss-scss',
      'postcss-flexbugs-fixes',
      'postcss-preset-env',
      'postcss-normalize'
    ]

    await installOptionalDependencies('PostCSS', postCssDependencies)

    const tailwindDependencies = ['tailwindcss']

    await installOptionalDependencies('Tailwind', tailwindDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Tailwind'))
    process.exit(0)
  }

  return [
    ...(isUsingTailwind(projectPath)
      ? [require.resolve('tailwindcss', {paths: [projectPath]})]
      : [])
  ]
}
