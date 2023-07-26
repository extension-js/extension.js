// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'

export function getTailwindConfigFile(projectDir: string) {
  const configFile = path.join(projectDir, 'tailwind.config.js')

  if (fs.existsSync(configFile)) return configFile

  return undefined
}

export function isUsingTailwind(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getTailwindConfigFile(projectDir)
  const packageJson = require(packageJsonPath)

  const tailwindAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.tailwind

  const tailwindAsDep =
    packageJson.dependencies && packageJson.dependencies.tailwind

  return configFile && !!(tailwindAsDevDep || tailwindAsDep)
}
