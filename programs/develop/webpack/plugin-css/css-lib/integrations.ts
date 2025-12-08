import * as path from 'path'
import * as fs from 'fs'
import {execSync} from 'child_process'
import colors from 'pintor'
import {detect} from 'package-manager-detector'

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

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[]
) {
  try {
    const pm = await detect()

    let installCommand = ''
    const quotedDir = JSON.stringify(__dirname)
    if (pm?.name === 'yarn') {
      installCommand = `yarn --silent add ${dependencies.join(
        ' '
      )} --cwd ${quotedDir} --optional`
    } else if (pm?.name === 'npm' || isFromNpx()) {
      installCommand = `npm --silent install ${dependencies.join(
        ' '
      )} --prefix ${quotedDir} --save-optional`
    } else if (isFromPnpx()) {
      installCommand = `pnpm --silent add ${dependencies.join(
        ' '
      )} --prefix ${quotedDir} --save-optional`
    } else {
      const pmName = typeof pm === 'string' ? pm : pm?.name || 'npm'
      installCommand = `${pmName} --silent install ${dependencies.join(
        ' '
      )} --cwd ${quotedDir} --optional`
    }

    console.log(`[${integration}] Installing optional dependencies...`)
    execSync(installCommand, {stdio: 'inherit'})
    await new Promise((r) => setTimeout(r, 500))

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('►►► Author says')} [${integration}] Installing root dependencies for dev...`
      )
      const devInstall =
        pm?.name === 'yarn'
          ? `yarn install --silent`
          : pm?.name === 'npm' || isFromNpx()
            ? `npm install --silent`
            : isFromPnpx()
              ? `pnpm install --silent`
              : `${typeof pm === 'string' ? pm : pm?.name || 'npm'} install --silent`
      execSync(devInstall, {stdio: 'ignore'})
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

  const packageJson = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  return !!dependencies[dependency] || !!devDependencies[dependency]
}
