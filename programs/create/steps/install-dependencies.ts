//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {spawn} from 'cross-spawn'
import * as fs from 'fs'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

function getInstallArgs() {
  return ['install', '--silent']
}

function resolveWindowsCmdExe(): string {
  const comspec = process.env.ComSpec
  if (comspec) return comspec
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'cmd.exe')
}

function formatCmdArgs(command: string, args: string[]) {
  const quotedCommand = command.includes(' ') ? `"${command}"` : command
  const quotedArgs = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
  return `${quotedCommand} ${quotedArgs.join(' ')}`.trim()
}

function resolveInstallInvocation(command: string, args: string[]) {
  if (process.platform !== 'win32') {
    return {command, args}
  }

  return {
    command: resolveWindowsCmdExe(),
    args: ['/d', '/s', '/c', formatCmdArgs(command, args)]
  }
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

async function updateExtensionDependencyTag(
  projectPath: string,
  projectName: string
) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  try {
    const raw = await fs.promises.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(raw)
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
      JSON.stringify(packageJson, null, 2) + '\n'
    )

    return true
  } catch (error) {
    console.error(messages.cantInstallDependencies(projectName, error))
    return false
  }
}

function shouldRetryWithTagFallback(output: string) {
  const text = output.toLowerCase()
  return (
    text.includes('no matching version found for extension@') ||
    text.includes('notarget') ||
    text.includes('etarget')
  )
}

async function runInstall(
  command: string,
  args: string[],
  cwd: string,
  stdio: 'inherit' | 'ignore' | 'pipe'
): Promise<InstallResult> {
  const invocation = resolveInstallInvocation(command, args)
  const child = spawn(invocation.command, invocation.args, {stdio, cwd})
  let stdout = ''
  let stderr = ''

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
  }

  return new Promise<InstallResult>((resolve, reject) => {
    child.on('close', (code) => {
      resolve({code, stderr, stdout})
    })

    child.on('error', (error) => {
      reject(error)
    })
  })
}

export async function installDependencies(
  projectPath: string,
  projectName: string
) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const command = await utils.getInstallCommand()
  const dependenciesArgs = getInstallArgs()

  console.log(messages.installingDependencies())

  try {
    // Create the node_modules directory if it doesn't exist
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
        ? await updateExtensionDependencyTag(projectPath, projectName)
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
  } catch (error: any) {
    console.error(
      messages.installingDependenciesProcessError(projectName, error)
    )
    console.error(messages.cantInstallDependencies(projectName, error))
    throw error
  }
}
