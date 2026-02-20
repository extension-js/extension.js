// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from './messages'
import {
  buildInstallCommand,
  execInstallCommand,
  resolvePackageManager
} from './package-manager'
import {writeInstallMarker} from './install-cache'

export async function getInstallCommand() {
  return resolvePackageManager({cwd: process.cwd()}).name
}

function getInstallArgs() {
  return ['install' /*, '--silent' */]
}

function findNearestWorkspaceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  while (true) {
    const workspaceFile = path.join(current, 'pnpm-workspace.yaml')
    if (fs.existsSync(workspaceFile)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function toRelativePath(baseDir: string, targetDir: string): string {
  return path.relative(baseDir, targetDir).split(path.sep).join('/')
}

function parseWorkspacePatterns(workspaceFilePath: string): string[] {
  try {
    const raw = fs.readFileSync(workspaceFilePath, 'utf8')
    const lines = raw.split(/\r?\n/)
    const patterns: string[] = []
    let inPackages = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!inPackages) {
        if (trimmed === 'packages:') inPackages = true
        continue
      }
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue
      if (!trimmed.startsWith('-')) break
      const value = trimmed.slice(1).trim()
      const unquoted = value.replace(/^['"]|['"]$/g, '')
      if (unquoted.length > 0) patterns.push(unquoted)
    }

    return patterns
  } catch {
    return []
  }
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob
    .replace(/^\.\//, '')
    .replace(/^!/, '')
    .replace(/\/+$/, '')
  let pattern = ''
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        pattern += '.*'
        i += 1
      } else {
        pattern += '[^/]*'
      }
      continue
    }
    if (/[|\\{}()[\]^$+?.]/.test(char)) {
      pattern += `\\${char}`
    } else {
      pattern += char
    }
  }
  return new RegExp(`^${pattern}$`)
}

function isProjectIncludedByWorkspace(
  workspaceRoot: string,
  projectPath: string
): boolean {
  const workspaceFile = path.join(workspaceRoot, 'pnpm-workspace.yaml')
  const patterns = parseWorkspacePatterns(workspaceFile)
  if (patterns.length === 0) return true

  const relativeProjectPath = toRelativePath(workspaceRoot, projectPath)
  let included = false

  for (const pattern of patterns) {
    const isNegated = pattern.startsWith('!')
    const matcher = globToRegExp(pattern)
    if (!matcher.test(relativeProjectPath)) continue
    included = !isNegated
  }

  return included
}

function shouldUsePnpmIsolatedInstall(projectPath: string): boolean {
  const workspaceRoot = findNearestWorkspaceRoot(projectPath)
  if (!workspaceRoot) return false
  return !isProjectIncludedByWorkspace(workspaceRoot, projectPath)
}

async function hasDependenciesToInstall(projectPath: string) {
  try {
    const raw = await fs.promises.readFile(
      path.join(projectPath, 'package.json'),
      'utf8'
    )
    const packageJson = JSON.parse(raw)
    const depsCount = Object.keys(packageJson?.dependencies || {}).length
    const devDepsCount = Object.keys(packageJson?.devDependencies || {}).length

    return depsCount + devDepsCount > 0
  } catch (error) {
    return true
  }
}

export async function installDependencies(projectPath: string) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const originalDirectory = process.cwd()
  const shouldInstall = await hasDependenciesToInstall(projectPath)

  if (!shouldInstall) {
    return
  }

  const progressLabel = messages.installingDependencies()

  try {
    // Change to the project directory before detecting package manager
    process.chdir(projectPath)

    const pm = resolvePackageManager({cwd: process.cwd()})
    let dependenciesArgs = getInstallArgs()
    // Ensure devDependencies are installed even if npm production config is set
    if (pm.name === 'npm') {
      dependenciesArgs = [...dependenciesArgs, '--include=dev']
    }
    // Excluded pnpm-workspace projects must install in isolated mode, otherwise
    // pnpm walks up to workspace root and skips local dependencies.
    if (pm.name === 'pnpm' && shouldUsePnpmIsolatedInstall(projectPath)) {
      dependenciesArgs = [
        ...dependenciesArgs,
        '--ignore-workspace',
        '--lockfile=false'
      ]
    }

    // Create the node_modules directory if it doesn't exist
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const stdio = isAuthor ? 'inherit' : 'ignore'
    console.log(progressLabel)

    if (isAuthor) {
      console.warn(messages.authorInstallNotice('project dependencies'))
    }

    const command = buildInstallCommand(pm, dependenciesArgs)
    await execInstallCommand(command.command, command.args, {
      cwd: projectPath,
      stdio
    })
    writeInstallMarker(projectPath)
  } catch (error: any) {
    console.error(messages.cantInstallDependencies(error))
    process.exit(1)
  } finally {
    // Ensure we revert to the original directory even if an error occurs
    process.chdir(originalDirectory)
  }
}
