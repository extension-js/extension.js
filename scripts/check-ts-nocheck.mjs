#!/usr/bin/env node

import {execSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

const NOT_SOURCE = /(?:^|\/)(?:dist|node_modules)\//

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g

const DIRECTIVE = /@ts-nocheck\b/

export function isScannedSource(file) {
  return SOURCE_EXTENSIONS.test(file) && !NOT_SOURCE.test(file)
}

// TypeScript reads @ts-nocheck from a line comment only, so the block form is
// inert: the file reads as exempt from typechecking and is checked anyway.
export function findBlockNoChecks(source) {
  const hits = []

  for (const match of source.matchAll(BLOCK_COMMENT)) {
    if (!DIRECTIVE.test(match[0])) continue

    const line = source.slice(0, match.index).split('\n').length
    const [text] = match[0].split('\n')

    hits.push({line, text: text.trim()})
  }

  return hits
}

// --others --exclude-standard includes new, not-yet-committed files, so a
// brand new file cannot introduce the dead directive and pass.
export function scannedFiles() {
  return execSync('git ls-files --cached --others --exclude-standard', {
    maxBuffer: 64 * 1024 * 1024
  })
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter(isScannedSource)
}

function run() {
  const files = scannedFiles()
  const offenders = []

  for (const file of files) {
    let text

    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    if (!DIRECTIVE.test(text)) continue

    for (const hit of findBlockNoChecks(text)) {
      offenders.push({file, ...hit})
    }
  }

  if (offenders.length === 0) {
    console.log(
      `check-ts-nocheck: no block-form @ts-nocheck in ${files.length} source files`
    )

    return 0
  }

  console.error(
    `check-ts-nocheck: found ${offenders.length} dead directive(s)\n`
  )

  for (const offender of offenders) {
    console.error(`  ${offender.file}:${offender.line}`)
    console.error(`    ${offender.text}\n`)
  }

  console.error(
    'TypeScript honors @ts-nocheck in a line comment only, so this file looks\n' +
      'exempt from typechecking and is checked anyway. Delete the comment if the\n' +
      'file is clean, or write the line form and record the exemption where the\n' +
      'typecheck project can be read, so it is visible rather than accidental.'
  )

  return 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.chdir(path.resolve(import.meta.dirname, '..'))
  process.exit(run())
}
