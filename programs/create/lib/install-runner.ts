//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {spawn} from 'cross-spawn'

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

function buildExecEnv(): NodeJS.ProcessEnv | undefined {
  if (process.platform !== 'win32') return undefined

  const nodeDir = path.dirname(process.execPath)
  const pathSep = path.delimiter
  const existing = process.env.PATH || process.env.Path || ''

  if (existing.includes(nodeDir)) return undefined

  return {
    ...process.env,
    PATH: `${nodeDir}${pathSep}${existing}`.trim(),
    Path: `${nodeDir}${pathSep}${existing}`.trim()
  }
}

type InstallResult = {
  code: number | null
  stderr: string
  stdout: string
}

export async function runInstall(
  command: string,
  args: string[],
  opts: {cwd: string; stdio: 'inherit' | 'ignore' | 'pipe'}
): Promise<InstallResult> {
  const invocation = resolveInstallInvocation(command, args)
  const env = buildExecEnv()
  const child = spawn(invocation.command, invocation.args, {
    stdio: opts.stdio,
    cwd: opts.cwd,
    env: env || process.env
  })
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
