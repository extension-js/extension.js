//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  parseJsoncSafe,
  parseNpmSpecifier,
  readDenoConfigDependencies
} from '../lib/deno-manifest'
import {runInstall as runInstallCommand} from '../lib/install-runner'
import * as messages from '../lib/messages'
import {
  isDenoRuntime,
  type ScaffoldPackageManager
} from '../lib/package-manager'
import * as utils from '../lib/utils'

function getInstallArgs(packageManager: string) {
  if (packageManager === 'bun') {
    return ['install']
  }

  return ['install', '--silent']
}

type InstallResult = {
  code: number | null
  stderr: string
  stdout: string
}

function getTagFallback(version: string) {
  if (version === '*' || version === 'latest' || version === 'next') {
    return null
  }

  const cleaned = version.replace(/^[~^]/, '')
  return cleaned.includes('-') ? 'next' : 'latest'
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target)
    return true
  } catch {
    return false
  }
}

// Deno discovers exactly one config file and prefers deno.json over deno.jsonc.
async function resolveDenoConfigPath(
  projectPath: string
): Promise<string | undefined> {
  for (const candidate of ['deno.json', 'deno.jsonc']) {
    const full = path.join(projectPath, candidate)
    if (await pathExists(full)) return full
  }
  return undefined
}

async function updatePackageJsonExtensionTag(
  projectPath: string
): Promise<boolean> {
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (!(await pathExists(packageJsonPath))) return false

  const packageJson = JSON.parse(
    await fs.promises.readFile(packageJsonPath, 'utf8')
  )
  const currentVersion = packageJson?.devDependencies?.extension

  if (typeof currentVersion !== 'string') {
    return false
  }

  const tag = getTagFallback(currentVersion)
  if (!tag || currentVersion === tag) {
    return false
  }

  packageJson.devDependencies = {
    ...(packageJson.devDependencies || {}),
    extension: tag
  }

  await fs.promises.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`
  )

  return true
}

// Surgical replace of the authored npm:extension@… specifier so JSONC
// comments and surrounding structure the template shipped stay put. A full
// parse → JSON.stringify rewrite would strip them.
function replaceExtensionSpecifierInDenoConfig(
  raw: string,
  currentSpecifier: string,
  nextSpecifier: string
): string | undefined {
  if (currentSpecifier === nextSpecifier) return undefined
  // Anchor on the quoted value site, not the first raw occurrence: a JSONC
  // comment quoting the same specifier earlier in the file must stay put.
  const quoted = `"${currentSpecifier}"`
  let from = 0
  while (from < raw.length) {
    const at = raw.indexOf(quoted, from)
    if (at === -1) return undefined
    const lineStart = raw.lastIndexOf('\n', at) + 1
    const lineBefore = raw.slice(lineStart, at)
    if (/:\s*$/.test(lineBefore) && !lineBefore.includes('//')) {
      const index = at + 1
      return (
        raw.slice(0, index) +
        nextSpecifier +
        raw.slice(index + currentSpecifier.length)
      )
    }
    from = at + quoted.length
  }
  return undefined
}

async function updateDenoConfigExtensionTag(
  projectPath: string
): Promise<boolean> {
  const configPath = await resolveDenoConfigPath(projectPath)
  if (!configPath) return false

  const raw = await fs.promises.readFile(configPath, 'utf8')
  const config = parseJsoncSafe(raw)
  const imports = config?.imports
  if (!imports || typeof imports !== 'object') return false

  let next = raw
  let updated = false
  for (const specifier of Object.values(imports as Record<string, unknown>)) {
    if (typeof specifier !== 'string') continue
    const parsed = parseNpmSpecifier(specifier)
    if (!parsed || parsed.name !== 'extension') continue

    const tag = getTagFallback(parsed.version)
    if (!tag || parsed.version === tag) continue

    const rewritten = replaceExtensionSpecifierInDenoConfig(
      next,
      specifier,
      `npm:extension@${tag}`
    )
    if (rewritten === undefined) continue
    next = rewritten
    updated = true
  }

  if (!updated) return false

  await fs.promises.writeFile(configPath, next)
  return true
}

// When the pinned extension version is gone from the registry, rewrite it to
// a floating tag and retry. npm projects carry the pin in package.json; Deno
// primary scaffolds retire package.json and pin via deno.json(c) imports, both
// manifests must be eligible for the same quiet recovery.
async function updateExtensionDependencyTag(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): Promise<boolean> {
  try {
    const updatedPackageJson = await updatePackageJsonExtensionTag(projectPath)
    const updatedDenoConfig = await updateDenoConfigExtensionTag(projectPath)
    return updatedPackageJson || updatedDenoConfig
  } catch (error) {
    logger.error(messages.cantInstallDependencies(projectName, error))
    return false
  }
}

// Only true "this version of extension does not exist on the registry" errors.
// Network flakiness, generic 404s, and other packages must not rewrite the pin.
function shouldRetryWithTagFallback(output: string) {
  const text = output.toLowerCase()
  return (
    text.includes('no matching version found for extension@') ||
    (text.includes('notarget') && text.includes('extension@')) ||
    (text.includes('etarget') && text.includes('extension@')) ||
    // Deno: Could not find version of npm package 'extension' matching '…'
    /could not find version of npm package ['"]?extension['"]?/.test(text)
  )
}

async function runInstall(
  command: string,
  args: string[],
  cwd: string,
  stdio: 'inherit' | 'ignore' | 'pipe'
): Promise<InstallResult> {
  return runInstallCommand(command, args, {cwd, stdio})
}

async function hasDependenciesToInstall(projectPath: string) {
  // When package.json is present, its deps alone decide, same as today for
  // npm scaffolds (empty package.json still skips). Only a missing file falls
  // through to the Deno config; a fat-fingered / unreadable package.json must
  // fail loudly rather than be treated as "no deps".
  const packageJsonPath = path.join(projectPath, 'package.json')
  let raw: string
  try {
    raw = await fs.promises.readFile(packageJsonPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      // Deno-primary (or a web-only remote template). Skip install when the
      // Deno imports map declares nothing to fetch either.
      return Object.keys(readDenoConfigDependencies(projectPath)).length > 0
    }
    throw error
  }

  const packageJson = JSON.parse(raw)
  const depsCount = Object.keys(packageJson?.dependencies || {}).length
  const devDepsCount = Object.keys(packageJson?.devDependencies || {}).length
  return depsCount + devDepsCount > 0
}

export async function installDependencies(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  packageManager?: ScaffoldPackageManager
) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const shouldInstall = await hasDependenciesToInstall(projectPath)

  if (!shouldInstall) {
    return
  }

  // The project's one manager installs it: the starter's pin when it has
  // one, otherwise the manager that ran this process (`prefers-yarn` can't
  // see Deno, so Deno is detected via its runtime globals).
  const command =
    packageManager ??
    (isDenoRuntime() ? 'deno' : await utils.getInstallCommand())
  const dependenciesArgs =
    command === 'deno' ? ['install'] : getInstallArgs(command)

  const installMessage = messages.installingDependencies()
  logger.log(installMessage)

  try {
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'pipe'
    const firstRun = await runInstall(
      command,
      dependenciesArgs,
      projectPath,
      stdio
    )

    if (firstRun.code !== 0) {
      const output = `${firstRun.stdout}\n${firstRun.stderr}`
      const shouldRetry = shouldRetryWithTagFallback(output)
      const didUpdate = shouldRetry
        ? await updateExtensionDependencyTag(projectPath, projectName, logger)
        : false

      if (didUpdate) {
        const retryRun = await runInstall(
          command,
          dependenciesArgs,
          projectPath,
          stdio
        )

        if (retryRun.code === 0) {
          return
        }
      }

      throw new Error(
        messages.installingDependenciesFailed(
          command,
          dependenciesArgs,
          firstRun.code
        )
      )
    }
  } catch (error) {
    logger.error(
      messages.installingDependenciesProcessError(projectName, error)
    )
    logger.error(messages.cantInstallDependencies(projectName, error))
    throw error
  }
}
