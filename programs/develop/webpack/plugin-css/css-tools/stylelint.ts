// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {type RspackPluginInstance} from '@rspack/core'
import colors from 'pintor'
import * as messages from '../css-lib/messages'

export function getStylelintConfigFile(projectPath: string) {
  const stylelintConfigJs = path.join(projectPath, 'stylelint.config.js')
  const stylelintConfigDotJs = path.join(projectPath, '.stylelintrc.js')
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
  if (!fs.existsSync(packageJsonPath)) return false

  const configFile = getStylelintConfigFile(projectPath)
  const isUsingStylelint = !!configFile

  if (isUsingStylelint) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('Stylelint')}`
        )
      }
      userMessageDelivered = true
    }
  }

  return isUsingStylelint
}

export async function maybeUseStylelint(
  projectPath: string
): Promise<RspackPluginInstance[]> {
  isUsingStylelint(projectPath)

  return []
}
