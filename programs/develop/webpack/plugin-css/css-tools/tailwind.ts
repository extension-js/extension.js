// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {bold, blue, magenta} from '@colors/colors'
import {execSync} from 'child_process'

export function getTailwindConfigFile(projectPath: string) {
  const configFileMjs = path.join(projectPath, 'tailwind.config.mjs')
  const configFileCjs = path.join(projectPath, 'tailwind.config.cjs')
  const configFileJs = path.join(projectPath, 'tailwind.config.js')

  if (fs.existsSync(configFileMjs)) return configFileMjs
  if (fs.existsSync(configFileCjs)) return configFileCjs
  if (fs.existsSync(configFileJs)) return configFileJs

  return undefined
}

let userMessageDelivered = false

export function isUsingTailwind(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getTailwindConfigFile(projectPath)
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
        `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
          manifest.version
        }) ` + `is using ${magenta('Tailwind')} config file.`
      )

      userMessageDelivered = true
    }
  }

  return isUsingTailwind
}

function installTailwind() {
  console.log('Tailwind is not installed. Installing...')
  execSync('npm install tailwindcss', {stdio: 'inherit'})
  console.log('React and related loaders installed successfully.')
}

export function maybeUseTailwindPlugin(projectPath: string, opts: any) {
  if (isUsingTailwind(projectPath)) {
    try {
      require.resolve('tailwindcss')
    } catch (e) {
      installTailwind()
      return []
    }

    return [
      ...(isUsingTailwind(projectPath)
        ? [require.resolve('tailwindcss', {paths: [projectPath]})]
        : [])
    ]
  }

  return []
}
