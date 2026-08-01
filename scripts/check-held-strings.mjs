#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {readdirSync, readFileSync, realpathSync, statSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIST = path.resolve(HERE, '..', 'programs', 'develop', 'dist')

export const HELD_STRINGS = [
  {
    string: 'unpublished-build-for-review?utm_source=cli-build',
    heldUntil: '2026-08-14',
    grandfathered: true,
    reason:
      'shipped in extension-develop since 4.0.23; standing decision is not to unpublish, so this entry never reds the gate. It records the held intent and its date. The gate protects future held strings.'
  }
]

export function dateToEpoch(value) {
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) {
    throw new Error(
      `held-string entry has an unparseable heldUntil date: ${value}`
    )
  }
  return ms
}

export function nowToEpoch(now) {
  if (now instanceof Date) return now.getTime()
  if (typeof now === 'number') return now
  const ms = Date.parse(now)
  if (Number.isNaN(ms)) {
    throw new Error(`unparseable now value: ${now}`)
  }
  return ms
}

export function findHeldViolations({heldStrings, distFiles, now}) {
  const nowMs = nowToEpoch(now)
  const violations = []
  for (const entry of heldStrings) {
    if (entry.grandfathered) continue
    const stillHeld = nowMs < dateToEpoch(entry.heldUntil)
    if (!stillHeld) continue
    for (const {file, contents} of distFiles) {
      if (contents.includes(entry.string)) {
        violations.push({
          string: entry.string,
          heldUntil: entry.heldUntil,
          file
        })
      }
    }
  }
  return violations
}

function readDistFiles(distDir) {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (stat.isFile()) {
        files.push({
          file: path.relative(distDir, full),
          contents: readFileSync(full, 'utf8')
        })
      }
    }
  }
  walk(distDir)
  return files
}

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function loadHeldStrings() {
  const heldPath = getArg('--held')
  if (!heldPath) return HELD_STRINGS
  const parsed = JSON.parse(readFileSync(heldPath, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`--held file must contain a JSON array: ${heldPath}`)
  }
  return parsed
}

function main() {
  const distDir = path.resolve(getArg('--dist') || DEFAULT_DIST)
  let distFiles
  try {
    distFiles = readDistFiles(distDir)
  } catch (error) {
    console.error(
      `error: could not read the extension-develop dist at ${distDir}`
    )
    console.error(String(error?.message ? error.message : error))
    process.exit(1)
    return
  }

  if (distFiles.length === 0) {
    console.error(
      `error: read zero files from ${distDir}. A held-string gate that scans nothing passes by doing nothing, which is the greenwash it exists to prevent.`
    )
    process.exit(1)
    return
  }

  const heldStrings = loadHeldStrings()
  const violations = findHeldViolations({
    heldStrings,
    distFiles,
    now: new Date()
  })

  if (violations.length === 0) {
    console.log(
      `Held-string gate passed: scanned ${distFiles.length} file(s) in ${distDir}, no held string ships before its date.`
    )
    process.exit(0)
    return
  }

  console.error(
    'error: extension-develop dist carries a string still under hold:'
  )
  for (const v of violations) {
    console.error(
      `  ${JSON.stringify(v.string)} held until ${v.heldUntil}, found in dist/${v.file}`
    )
  }
  console.error(
    'Remove the held string from the build, or move its heldUntil date to today or earlier once the hold is intentionally released.'
  )
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main()
}
