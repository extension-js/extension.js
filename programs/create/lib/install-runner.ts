//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {spawn} from 'cross-spawn'

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
  const env = buildExecEnv()
  const child = spawn(command, args, {
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
