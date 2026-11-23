// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {CODES} from '../../helpers/messaging'
import {type BinaryEnvOverride, binaryEnvOverride} from './binary-env-override'
import * as messages from './messages'

export type PinnedBinaryProblem = 'missing' | 'not-executable'

// A pin the user typed is checked before any spawn, so a file the system
// will not run is refused as a bad value and not reported as a launch.
export function pinnedBinaryProblem(
  binaryPath: string | null | undefined
): PinnedBinaryProblem | null {
  if (!binaryPath) return 'missing'

  let stat: fs.Stats

  try {
    stat = fs.statSync(binaryPath)
  } catch {
    return 'missing'
  }

  if (stat.isDirectory()) {
    // A macOS app bundle is a directory that the launchers resolve inside.
    return /\.app\/?$/i.test(binaryPath) ? null : 'not-executable'
  }

  if (process.platform === 'win32') return null

  try {
    fs.accessSync(binaryPath, fs.constants.X_OK)

    return null
  } catch {
    return 'not-executable'
  }
}

// A variable the person set is a choice like the flag, so a path that names
// nothing or cannot run is refused by name and never skipped.
export function envPinnedBinary(
  browser: string,
  env: Record<string, string | undefined> = process.env,
  normalize: (binaryPath: string) => string = (binaryPath) => binaryPath
): BinaryEnvOverride | null {
  const override = binaryEnvOverride(browser, env)
  if (!override) return null

  const normalized = normalize(override.path) || override.path
  const problem = pinnedBinaryProblem(normalized)

  if (problem) {
    throw Object.assign(
      new Error(
        problem === 'not-executable'
          ? messages.binaryNotExecutable(override.path, override.name)
          : messages.binaryOverrideNotFound(override.name, override.path)
      ),
      {code: CODES.E_BROWSER_BINARY_INVALID}
    )
  }

  return {name: override.name, path: normalized}
}

// The binary a launch runs and the flag or variable that chose it.
export interface LaunchPin {
  path?: string | null
  pinnedBy?: string
}

function spawnErrno(error: unknown): string | null {
  const {code, syscall} = (error ?? {}) as {code?: unknown; syscall?: unknown}

  if (typeof syscall !== 'string' || !/^spawn\b/.test(syscall)) return null

  return typeof code === 'string' && code ? code : 'UNKNOWN'
}

// Plain words for the errno a spawn refusal carries. Windows answers UNKNOWN
// for a file that is not a program, where POSIX says ENOEXEC or EFTYPE.
export function spawnRefusalWords(
  error: unknown,
  platform: NodeJS.Platform = process.platform
): string | null {
  const errno = spawnErrno(error)
  if (!errno) return null

  const words =
    errno === 'ENOENT'
      ? 'the file, or the interpreter its first line names, was not found'
      : errno === 'EACCES' || errno === 'EPERM'
        ? 'the system denied permission to run this file'
        : errno === 'ENOEXEC' || errno === 'EFTYPE'
          ? 'this file is not in a format the system can run'
          : / -86$/.test(errno)
            ? 'this file is built for another processor'
            : platform === 'win32'
              ? 'Windows could not start this file as a program'
              : 'the system could not start this file'

  return `${words} (spawn ${errno})`
}

// A pinned file the system refused to run is the person's value to change,
// so the refusal names the file and what pinned it. Anything else passes.
export function pinnedBinarySpawnError(error: unknown, pin: LaunchPin) {
  const refusal = pin.path && pin.pinnedBy ? spawnRefusalWords(error) : null
  if (!refusal) return error

  const {code, syscall} = error as {code?: unknown; syscall?: unknown}

  return Object.assign(
    new Error(
      messages.pinnedBinaryCouldNotRun(
        String(pin.path),
        String(pin.pinnedBy),
        refusal
      )
    ),
    {code, syscall, cause: error}
  )
}

// The sentence a browser that left at once adds when its binary was pinned.
export function pinnedBinaryExitNote(pin: LaunchPin): string {
  return pin.path && pin.pinnedBy
    ? messages.pinnedBinaryMayNotBeBrowser(pin.path, pin.pinnedBy)
    : ''
}
