import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A spec that needs the machine's own temp directory reads it from here.
export const REAL_TEMP_ENV = 'EXTJS_SPEC_REAL_TMPDIR'
// Unix reads TMPDIR. Windows reads TEMP, then TMP.
const TEMP_ENV_NAMES = ['TMPDIR', 'TEMP', 'TMP']
// Kept short: socket paths made under it have about 100 characters in all.
const RUN_FOLDER_PREFIX = 'extjs-run-'

// Points the temp directory of this process, and of every worker and child
// it starts from here on, at one folder that `leave` removes with all in it.
export function enterRunTempFolder(env = process.env) {
  const real = env[REAL_TEMP_ENV] || os.tmpdir()
  const folder = fs.mkdtempSync(path.join(real, RUN_FOLDER_PREFIX))
  const before = new Map(
    [...TEMP_ENV_NAMES, REAL_TEMP_ENV].map((name) => [name, env[name]])
  )
  let left = false

  env[REAL_TEMP_ENV] = real
  for (const name of TEMP_ENV_NAMES) env[name] = folder

  const leave = () => {
    if (left) return

    left = true

    for (const [name, value] of before) {
      if (value === undefined) delete env[name]
      else env[name] = value
    }

    try {
      fs.rmSync(folder, {recursive: true, force: true, maxRetries: 3})
    } catch {
      // A file a child still holds open stays until that child is gone.
    }
  }

  // The runner's teardown is skipped when the run dies on an error.
  process.once('exit', leave)

  return {folder, real, leave}
}

// A spec file that has to work in the machine's own temp directory calls
// this at its top. It changes the worker it runs in and nothing else.
export function useRealTempDirectory(env = process.env) {
  const real = env[REAL_TEMP_ENV]

  if (!real) return os.tmpdir()

  for (const name of TEMP_ENV_NAMES) env[name] = real

  return real
}

// Vitest calls this once in its main process, before any worker starts, and
// calls what it returns after the last one ended, passed or not.
export default function setup() {
  const run = enterRunTempFolder()

  return () => run.leave()
}
