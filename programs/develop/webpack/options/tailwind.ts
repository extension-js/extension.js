// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {bold, blue, magenta} from '@colors/colors'

export function getTailwindConfigFile(projectDir: string) {
  const configFileMjs = path.join(projectDir, 'tailwind.config.mjs')
  const configFileCjs = path.join(projectDir, 'tailwind.config.cjs')
  const configFileJs = path.join(projectDir, 'tailwind.config.js')

  if (fs.existsSync(configFileMjs)) return configFileMjs
  if (fs.existsSync(configFileCjs)) return configFileCjs
  if (fs.existsSync(configFileJs)) return configFileJs

  return undefined
}

let userMessageDelivered = false

export function isUsingTailwind(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')
  const manifestJsonPath = path.join(projectDir, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getTailwindConfigFile(projectDir)
  const packageJson = require(packageJsonPath)

  const tailwindAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.tailwindcss

  const tailwindAsDep =
    packageJson.dependencies && packageJson.dependencies.tailwindcss

  const manifest = require(manifestJsonPath)
  const isUsingTailwind = !!configFile && !!(tailwindAsDevDep || tailwindAsDep)

  if (isUsingTailwind) {
    if (!userMessageDelivered) {
      // This message is shown for each CSS loader we have, so we only want to show it once.
      console.log(
        bold(
          `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${manifest.version}) `
        ) + `is using ${bold(magenta('Tailwind'))} config file.`
      )

      userMessageDelivered = true
    }
  }

  return isUsingTailwind
}
