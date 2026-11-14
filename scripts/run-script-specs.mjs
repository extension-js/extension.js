#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {enterRunTempFolder} from './lib/spec-temp-folder.mjs'

const specDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__spec__'
)

export function listScriptSpecs(dir = specDir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.spec.mjs'))
    .sort()
    .map((name) => path.join(dir, name))
}

// Runs the script specs with one temp folder for the whole run, removed when
// the run ends. Arguments name the spec files to run in place of all of them.
export function runScriptSpecs(argv = process.argv.slice(2)) {
  const flags = argv.filter((arg) => arg.startsWith('-'))
  const named = argv.filter((arg) => !arg.startsWith('-'))
  const run = enterRunTempFolder()

  try {
    const result = spawnSync(
      process.execPath,
      ['--test', ...flags, ...(named.length > 0 ? named : listScriptSpecs())],
      {stdio: 'inherit', env: process.env}
    )

    if (result.error) throw result.error

    return result.status ?? 1
  } finally {
    run.leave()
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(runScriptSpecs())
}
