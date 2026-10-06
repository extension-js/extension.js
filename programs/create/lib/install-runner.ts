//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {spawn} from 'cross-spawn'
import {corepackRegistryEnv} from './corepack-registry'

// A package manager exports every npm config it read as an npm_config_* variable,
// so the invoking checkout's release-age rule would govern the new project's
// install. The project never agreed to it, and its own .npmrc still wins here.
// A rule the user exported on purpose is theirs and travels through: only a
// value that matches the .npmrc the invoking package manager read is dropped.
const INHERITED_RELEASE_AGE =
  /^(?:npm|pnpm)_config_minimum[-_]?release[-_]?age$/i
const INHERITED_RELEASE_AGE_RULE =
  /^(?:npm|pnpm)_config_minimum[-_]?release[-_]?age/i
const NPMRC_RELEASE_AGE = /^\s*minimum-release-age\s*=\s*(.*?)\s*$/

function readNpmrcReleaseAge(dir: string): string | null {
  try {
    for (const line of fs
      .readFileSync(path.join(dir, '.npmrc'), 'utf8')
      .split(/\r?\n/)) {
      const match = NPMRC_RELEASE_AGE.exec(line)
      if (match) return match[1]
    }
  } catch {
    // No .npmrc here, keep walking.
  }

  return null
}

// The release age the invoking package manager read from a .npmrc, walking
// up from where it was started (INIT_CWD under npm, pnpm and yarn scripts).
export function invokingNpmrcReleaseAge(
  source: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): string | null {
  const starts = [source.INIT_CWD, cwd].filter((dir): dir is string =>
    Boolean(dir)
  )

  for (const start of starts) {
    let dir = path.resolve(start)

    while (true) {
      const found = readNpmrcReleaseAge(dir)
      if (found !== null) return found

      const parent = path.dirname(dir)
      if (parent === dir) break

      dir = parent
    }
  }

  return null
}

export function withoutInheritedReleaseAge(
  source: Record<string, string | undefined>,
  npmrcReleaseAge: string | null = invokingNpmrcReleaseAge(source)
): Record<string, string | undefined> {
  const env = {...source}
  const inherited = Object.keys(env).filter(
    (key) =>
      INHERITED_RELEASE_AGE.test(key) &&
      npmrcReleaseAge !== null &&
      String(env[key] ?? '').trim() === npmrcReleaseAge
  )

  if (inherited.length === 0) return env

  // The exclusions that ride along with that rule go with it.
  for (const key of Object.keys(env)) {
    if (INHERITED_RELEASE_AGE_RULE.test(key)) {
      Reflect.deleteProperty(env, key)
    }
  }

  return env
}

function buildExecEnv(cwd: string): Record<string, string | undefined> {
  const env = {
    ...withoutInheritedReleaseAge(process.env),
    ...corepackRegistryEnv(process.env, cwd)
  }

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
    env: buildExecEnv(opts.cwd) as NodeJS.ProcessEnv
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
