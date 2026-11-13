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
