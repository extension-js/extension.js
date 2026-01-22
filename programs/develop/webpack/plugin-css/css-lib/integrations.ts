//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {execSync} from 'child_process'
import colors from 'pintor'

function parseJsonSafe(text: string) {
  const s = text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return JSON.parse(s || '{}')
}

function isFromPnpx() {
  if (process.env.npm_config_user_agent?.includes('pnpm')) return 'pnpm'
  return false
}

function isFromNpx() {
  if ((process.env as any)['npm_execpath']) return 'npm'
  return false
}

type DetectedPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun'

function getPackageManagerFromEnv(): DetectedPackageManager | undefined {
  const ua = process.env.npm_config_user_agent

  if (ua) {
    if (ua.includes('pnpm')) return 'pnpm'
    if (ua.includes('yarn')) return 'yarn'
    if (ua.includes('bun')) return 'bun'
    if (ua.includes('npm')) return 'npm'
  }

  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH

  if (execPath) {
    if (execPath.includes('pnpm')) return 'pnpm'
    if (execPath.includes('yarn')) return 'yarn'
    if (execPath.includes('bun')) return 'bun'
    if (execPath.includes('npm')) return 'npm'
  }

  return undefined
}

async function resolvePackageManager(): Promise<DetectedPackageManager> {
  const envPm = getPackageManagerFromEnv()
  if (envPm) return envPm
  return 'npm'
}

function getOptionalInstallCommand(
  pm: DetectedPackageManager,
  dependencies: string[]
): string {
  const quotedDir = JSON.stringify(__dirname)
  const pmName = pm
  if (pmName === 'yarn') {
    return `yarn --silent add ${dependencies.join(
      ' '
    )} --cwd ${quotedDir} --optional`
  }
  if (pmName === 'npm' || isFromNpx()) {
    return `npm --silent install ${dependencies.join(
      ' '
    )} --prefix ${quotedDir} --save-optional`
  }
  if (isFromPnpx()) {
    return `pnpm --silent add ${dependencies.join(
      ' '
    )} --prefix ${quotedDir} --save-optional`
  }
  const fallback = pmName || 'npm'
  return `${fallback} --silent install ${dependencies.join(
    ' '
  )} --cwd ${quotedDir} --optional`
}

function getRootInstallCommand(pm: DetectedPackageManager): string {
  const pmName = pm
  if (pmName === 'yarn') return `yarn install --silent`
  if (pmName === 'npm' || isFromNpx()) return `npm install --silent`
  if (isFromPnpx()) return `pnpm install --silent`
  return `${pmName || 'npm'} install --silent`
}

function formatToolingLabel(
  integrations: string[] | undefined,
  fallback: string
) {
  const list =
    integrations && integrations.length > 0 ? integrations.join('/') : fallback
  return `Setting up ${list} tooling...`
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[]
) {
  if (!dependencies.length) return
  try {
    const pm = await resolvePackageManager()
    const installCommand = getOptionalInstallCommand(pm, dependencies)

    console.log(formatToolingLabel([integration], integration))
    execSync(installCommand, {stdio: 'inherit'})
    await new Promise((r) => setTimeout(r, 500))

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('►►► Author says')} [${integration}] Installing root dependencies for dev...`
      )
      execSync(getRootInstallCommand(pm), {stdio: 'ignore'})
      console.log(
        `${colors.brightMagenta('►►► Author says')} ${integration} tooling ready.`
      )
    }
  } catch (error) {
    console.error(`[${integration}] Failed to install dependencies.`, error)
  }
}

export async function installOptionalDependenciesBatch(
  integration: string,
  dependencies: string[],
  integrations?: string[]
) {
  if (!dependencies.length) return
  try {
    const pm = await resolvePackageManager()
    const installCommand = getOptionalInstallCommand(pm, dependencies)

    console.log(formatToolingLabel(integrations, integration))
    execSync(installCommand, {stdio: 'inherit'})
    await new Promise((r) => setTimeout(r, 500))

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('►►► Author says')} [${integration}] Installing root dependencies for dev...`
      )
      execSync(getRootInstallCommand(pm), {stdio: 'ignore'})
      console.log(
        `${colors.brightMagenta('►►► Author says')} ${integration} tooling ready.`
      )
    }
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

  const packageJson = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  return !!dependencies[dependency] || !!devDependencies[dependency]
}
