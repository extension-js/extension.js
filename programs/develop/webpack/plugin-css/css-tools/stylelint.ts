// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {bold, blue, bgBlack, white} from '@colors/colors'
import {execSync} from 'child_process'

export function getStylelintConfigFile(projectPath: string) {
  const stylelintConfigJs = path.join(projectPath, 'stylelint.config.js')
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
        `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
          manifest.version
        }) ` + `is using ${bgBlack(white('Stylelint'))} config file.`
      )

      userMessageDelivered = true
    }
  }

  return isUsingStylelint
}

function installStylelint() {
  console.log('Stylelint is not installed. Installing...')
  execSync('npm install stylelint', {stdio: 'inherit'})
  console.log('React and related loaders installed successfully.')
}

export function maybeUseStylelintPlugin(projectPath: string, opts: any) {
  if (isUsingStylelint(projectPath)) {
    try {
      require.resolve('stylelint')
    } catch (e) {
      installStylelint()
    }

    const StylelintPlugin = require('stylelint-webpack-plugin')

    return [
      new StylelintPlugin({
        context: projectPath,
        configFile: isUsingStylelint(projectPath)
          ? getStylelintConfigFile(projectPath)
          : path.join(__dirname, 'stylelint.config.js'),
        files: '**/*.{css,scss,sass,less}',
        exclude: ['node_modules', path.join(projectPath, 'node_modules')]
      })
    ]
  }

  return []
}
