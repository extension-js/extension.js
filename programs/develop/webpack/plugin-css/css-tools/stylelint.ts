// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {type WebpackPluginInstance} from 'webpack'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'

export function getStylelintConfigFile(projectPath: string) {
  const stylelintConfigJs = path.join(projectPath, 'stylelint.config.json')
  const stylelintConfigDotJs = path.join(projectPath, '.stylelintrc.js file')
  const stylelintConfigMjs = path.join(projectPath, 'stylelint.config.mjs')
  const stylelintConfigDotMjs = path.join(projectPath, '.stylelintrc.mjs')
  const stylelintConfigCjs = path.join(projectPath, 'stylelint.config.cjs')
  const stylelintConfigDotCjs = path.join(projectPath, '.stylelintrc.cjs')
  const stylelintConfigJson = path.join(projectPath, '.stylelintrc.json')
  const stylelintConfigDotJson = path.join(projectPath, '.stylelintrc')
  const stylelintConfigYml = path.join(projectPath, '.stylelintrc.yml')
  const stylelintConfigDotYml = path.join(projectPath, '.stylelintrc.yaml')

  if (fs.existsSync(stylelintConfigJs)) return stylelintConfigJs
  if (fs.existsSync(stylelintConfigDotJs)) return stylelintConfigDotJs
  if (fs.existsSync(stylelintConfigMjs)) return stylelintConfigMjs
  if (fs.existsSync(stylelintConfigDotMjs)) return stylelintConfigDotMjs
  if (fs.existsSync(stylelintConfigCjs)) return stylelintConfigCjs
  if (fs.existsSync(stylelintConfigDotCjs)) return stylelintConfigDotCjs
  if (fs.existsSync(stylelintConfigJson)) return stylelintConfigJson
  if (fs.existsSync(stylelintConfigDotJson)) return stylelintConfigDotJson
  if (fs.existsSync(stylelintConfigYml)) return stylelintConfigYml
  if (fs.existsSync(stylelintConfigDotYml)) return stylelintConfigDotYml

  return undefined
}

let userMessageDelivered = false

export function isUsingStylelint(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getStylelintConfigFile(projectPath)
  const isUsingStylelint = !!configFile

  if (isUsingStylelint) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      const manifestName = manifest.name || 'Extension.js'
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration(manifestName, 'Stylelint'))
      }
      userMessageDelivered = true
    }
  }

  return isUsingStylelint
}

export async function maybeUseStylelint(
  projectPath: string
): Promise<WebpackPluginInstance[]> {
  if (!isUsingStylelint(projectPath)) return []

  try {
    require.resolve('stylelint')
  } catch (e) {
    const stylelintDependencies = [
      'stylelint',
      'stylelint-webpack-plugin',
      'stylelint-config-standard-scss'
    ]
    const projectName = require(path.join(projectPath, 'package.json')).name
    await installOptionalDependencies(
      projectName,
      'Stylelint',
      stylelintDependencies
    )

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.

    console.log(messages.youAreAllSet(projectName, 'Stylelint'))
    process.exit(0)
  }

  const StylelintPlugin = require('stylelint-webpack-plugin')

  return [
    new StylelintPlugin({
      context: projectPath,
      configFile: isUsingStylelint(projectPath)
        ? getStylelintConfigFile(projectPath)
        : path.join(__dirname, 'stylelint.config.json'),
      files: '**/*.{css,scss,sass,less}',
      exclude: ['node_modules', path.join(projectPath, 'node_modules')]
    })
  ]
}
