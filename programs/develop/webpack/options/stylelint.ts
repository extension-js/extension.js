// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {bold, blue, bgBlack, white} from '@colors/colors'

export function getStylelintConfigFile(projectDir: string) {
  const stylelintConfigJs = path.join(projectDir, 'stylelint.config.js')
  const stylelintConfigDotJs = path.join(projectDir, '.stylelintrc.js file')
  const stylelintConfigMjs = path.join(projectDir, 'stylelint.config.mjs')
  const stylelintConfigDotMjs = path.join(projectDir, '.stylelintrc.mjs')
  const stylelintConfigCjs = path.join(projectDir, 'stylelint.config.cjs')
  const stylelintConfigDotCjs = path.join(projectDir, '.stylelintrc.cjs')
  const stylelintConfigJson = path.join(projectDir, '.stylelintrc.json')
  const stylelintConfigDotJson = path.join(projectDir, '.stylelintrc')
  const stylelintConfigYml = path.join(projectDir, '.stylelintrc.yml')
  const stylelintConfigDotYml = path.join(projectDir, '.stylelintrc.yaml')

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

export function isUsingStylelint(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')
  const manifestJsonPath = path.join(projectDir, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getStylelintConfigFile(projectDir)
  const packageJson = require(packageJsonPath)

  const stylelintAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.stylelint

  const stylelintAsDep =
    packageJson.dependencies && packageJson.dependencies.stylelint

  const manifest = require(manifestJsonPath)
  const isUsingStylelint =
    !!configFile && !!(stylelintAsDevDep || stylelintAsDep)

  if (isUsingStylelint) {
    if (!userMessageDelivered) {
      // This message is shown for each CSS loader we have, so we only want to show it once.
      console.log(
        bold(
          `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${manifest.version}) `
        ) + `is using ${bgBlack(bold(white('Stylelint')))} config file.`
      )

      userMessageDelivered = true
    }
  }

  return isUsingStylelint
}
