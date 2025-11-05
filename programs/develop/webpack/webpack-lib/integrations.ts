import * as path from 'path'
import * as fs from 'fs'
import {execSync} from 'child_process'
import {detect} from 'package-manager-detector'
import * as messages from './messages'

export function isFromPnpx() {
  if (process.env.npm_config_user_agent) {
    if (process.env.npm_config_user_agent.includes('pnpm')) {
      return 'pnpm'
    }
  }

  return false
}

export function isFromNpx() {
  if ((process.env as any)['npm_execpath']) {
    return 'npm'
  }

  return false
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[]
) {
  try {
    const pm = await detect()

    console.log(
      messages.integrationNotInstalled(integration, pm?.name || 'unknown')
    )

    let installCommand = ''
    if (pm?.name === 'yarn') {
      installCommand = `yarn --silent add ${dependencies.join(
        ' '
      )} --cwd ${__dirname} --optional`
    } else if (pm?.name === 'npm' || isFromNpx()) {
      installCommand = `npm  --silent install ${dependencies.join(
        ' '
      )} --prefix ${__dirname} --save-optional`
    } else if (isFromPnpx()) {
      installCommand = `pnpm --silent add ${dependencies.join(
        ' '
      )} --prefix ${__dirname} --save-optional`
    } else {
      installCommand = `${pm} --silent install ${dependencies.join(
        ' '
      )} --cwd ${__dirname} --optional`
    }

    execSync(installCommand, {stdio: 'inherit'})

    // Adding a minimal delay to ensure the modules are installed and available (optimized from 2s to 500ms)
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.installingRootDependencies(integration))

      if (pm?.name === 'yarn') {
        installCommand = `yarn install --silent > /dev/null 2>&1`
      } else if (pm?.name === 'npm' || isFromNpx()) {
        installCommand = `npm install --silent > /dev/null 2>&1`
      } else if (isFromPnpx()) {
        installCommand = `pnpm install --silent > /dev/null 2>&1`
      } else {
        installCommand = `${pm} install --silent > /dev/null 2>&1`
      }

      execSync(installCommand, {stdio: 'inherit'})
    }

    console.log(messages.integrationInstalledSuccessfully(integration))
  } catch (error) {
    console.error(messages.failedToInstallIntegration(integration, error))
  }
}

export function isUsingJSFramework(projectPath: string): boolean {
  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]

  return frameworks.some((framework) => hasDependency(projectPath, framework))
}

export function hasDependency(projectPath: string, dependency: string) {
  // Find nearest package.json starting from projectPath and walking up a few levels
  const findNearestPackageJsonDirectory = (
    startPath: string
  ): string | undefined => {
    let currentDirectory = startPath
    const maxDepth = 4

    for (let i = 0; i < maxDepth; i++) {
      const candidate = path.join(currentDirectory, 'package.json')
      if (fs.existsSync(candidate)) return currentDirectory

      const parentDirectory = path.dirname(currentDirectory)
      if (parentDirectory === currentDirectory) break

      currentDirectory = parentDirectory
    }
    return undefined
  }

  const packageJsonDirectory = findNearestPackageJsonDirectory(projectPath)
  if (!packageJsonDirectory) return false

  const packageJsonPath = path.join(packageJsonDirectory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return false

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  return !!dependencies[dependency] || !!devDependencies[dependency]
}
