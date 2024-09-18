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
  // process.cwd() because the package.json is in the root of the project
  // but the manifest.json can be anywhere in the project.
  const packageJsonPath = path.join(process.cwd(), 'package.json')
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
  isUsingStylelint(projectPath)

  return []
}
