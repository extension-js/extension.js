import * as path from 'path'
import * as fs from 'fs'
import {execSync} from 'child_process'
import {detect} from 'package-manager-detector'

function isFromPnpx() {
  if (process.env.npm_config_user_agent?.includes('pnpm')) return 'pnpm'
  return false
}

function isFromNpx() {
  if ((process.env as any)['npm_execpath']) return 'npm'
  return false
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[]
) {
  try {
    const pm = await detect()

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

    console.log(`[${integration}] Installing optional dependencies...`)
    execSync(installCommand, {stdio: 'inherit'})
    await new Promise((r) => setTimeout(r, 500))

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(`[${integration}] Installing root dependencies for dev...`)
      if (pm?.name === 'yarn')
        execSync(`yarn install --silent > /dev/null 2>&1`, {stdio: 'inherit'})
      else if (pm?.name === 'npm' || isFromNpx())
        execSync(`npm install --silent > /dev/null 2>&1`, {stdio: 'inherit'})
      else if (isFromPnpx())
        execSync(`pnpm install --silent > /dev/null 2>&1`, {stdio: 'inherit'})
      else
        execSync(`${pm} install --silent > /dev/null 2>&1`, {stdio: 'inherit'})
    }

    console.log(`[${integration}] Dependencies installed successfully.`)
  } catch (error) {
    console.error(`[${integration}] Failed to install dependencies.`, error)
  }
}

export function hasDependency(projectPath: string, dependency: string) {
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
