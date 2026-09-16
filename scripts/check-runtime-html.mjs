#!/usr/bin/env node

import {execSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

// Every line of these two programs either runs inside the user's extension or
// writes code that does, so an innerHTML here reaches a shipped bundle.
const RUNTIME_ROOTS = ['programs/develop/', 'programs/extension/']

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/

// Specs and build output never reach a bundle, and node_modules is not ours.
const NOT_RUNTIME = /(?:^|\/)(?:__spec__|dist|node_modules)\//

// addons-linter raises UNSAFE_VAR_ASSIGNMENT on the write, not the read, so
// the rules match the assignment forms and leave `'innerHTML' in el` alone.
const RULES = [
  {
    name: 'property assignment',
    pattern: /\.(inner|outer)HTML\s*=(?!=)/
  },
  {
    name: 'computed assignment',
    pattern: /\[\s*['"`](inner|outer)HTML['"`]\s*\]\s*=(?!=)/
  },
  {
    name: 'object property',
    pattern: /(?:^|[^A-Za-z0-9_$.])(inner|outer)HTML\s*:/
  }
]

export function isRuntimeSource(file) {
  return (
    RUNTIME_ROOTS.some((root) => file.startsWith(root)) &&
    SOURCE_EXTENSIONS.test(file) &&
    !NOT_RUNTIME.test(file)
  )
}

// Exported so the spec can drive the rules over fixture text without touching
// the working tree.
export function findHtmlAssignments(source) {
  const hits = []

  source.split('\n').forEach((line, index) => {
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue

      hits.push({line: index + 1, rule: rule.name, text: line.trim()})
      break
    }
  })

  return hits
}

// --others --exclude-standard includes new, not-yet-committed files, so a
// brand new runtime file cannot introduce an assignment and pass.
export function runtimeFiles() {
  return execSync('git ls-files --cached --others --exclude-standard', {
    maxBuffer: 64 * 1024 * 1024
  })
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter(isRuntimeSource)
}

function run() {
  const files = runtimeFiles()
  const offenders = []

  for (const file of files) {
    let text

    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    if (!/(inner|outer)HTML/.test(text)) continue

    for (const hit of findHtmlAssignments(text)) {
      offenders.push({file, ...hit})
    }
  }

  if (offenders.length === 0) {
    console.log(
      `check-runtime-html: no innerHTML assignment in ${files.length} runtime files`
    )

    return 0
  }

  console.error(
    `check-runtime-html: found ${offenders.length} unsafe assignment(s)\n`
  )

  for (const o of offenders) {
    const snippet = o.text.length > 100 ? `${o.text.slice(0, 100)}...` : o.text
    console.error(`  ${o.file}:${o.line}  [${o.rule}]`)
    console.error(`    ${snippet}\n`)
  }

  console.error(
    'Runtime code ships into the add-on a developer submits, and addons-linter\n' +
      'flags every innerHTML write as UNSAFE_VAR_ASSIGNMENT. Use textContent for\n' +
      'plain text, build the nodes, or insertAdjacentHTML on a trusted literal.'
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
