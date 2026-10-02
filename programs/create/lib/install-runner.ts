//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {spawn} from 'cross-spawn'

// A package manager exports every npm config it read as an npm_config_* variable,
// so the invoking checkout's release-age rule would govern the new project's
// install. The project never agreed to it, and its own .npmrc still wins here.
const INHERITED_RELEASE_AGE =
  /^(?:npm|pnpm)_config_minimum[-_]?release[-_]?age/i

function withoutInheritedReleaseAge(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env = {...source}

  for (const key of Object.keys(env)) {
    if (INHERITED_RELEASE_AGE.test(key)) {
      Reflect.deleteProperty(env, key)
    }
  }

  return env
}

function buildExecEnv(): NodeJS.ProcessEnv {
  const env = withoutInheritedReleaseAge(process.env)

  if (process.platform !== 'win32') return env

  const nodeDir = path.dirname(process.execPath)
  const pathSep = path.delimiter
  const existing = process.env.PATH || process.env.Path || ''

  if (existing.includes(nodeDir)) return env

  return {
    ...env,
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
  const child = spawn(command, args, {
    stdio: opts.stdio,
    cwd: opts.cwd,
    // cross-spawn runs the .cmd shims on Windows and escapes each argument,
    // so the project path never becomes part of a shell string.
    env: buildExecEnv()
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
