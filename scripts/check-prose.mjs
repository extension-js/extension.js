#!/usr/bin/env node
// Fails when an em dash (U+2014) appears in tracked source, comments, or docs.
//
// House rule: use a comma, a colon, or parentheses instead. Paired dashes
// almost always want parentheses; a dash before a coordinating conjunction
// wants a comma; a dash before an independent clause wants a period, otherwise
// you manufacture a comma splice.
//
// Vale is not usable here: most of this repo's prose lives inside TypeScript
// string literals and comments (the messages.ts catalogs), which Vale does not
// lint. A targeted check covers every file type instead.
import {execSync} from 'node:child_process'
import fs from 'node:fs'

const EM_DASH = '—'

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|json|yml|yaml)$/

// Paths where the character is data rather than prose.
const EXCLUDED_PATHS = [
  // Vendored third-party fork; not ours to restyle.
  'webpack-target-webextension-fork',
  // This checker necessarily contains the character it searches for.
  'scripts/check-prose.mjs'
]

// Exact lines where the em dash is the subject, not punctuation.
const ALLOWED_LINES = [
  "// Prefix candidates (try swapping if desired): '⏵', '›', '→', '—'"
]

// --others --exclude-standard includes new, not-yet-committed files. Without it
// a brand new file could introduce em dashes and pass the check.
const tracked = execSync('git ls-files --cached --others --exclude-standard', {
  maxBuffer: 64 * 1024 * 1024
})
  .toString()
  .split('\n')
  .filter(Boolean)
  .filter((f) => EXTENSIONS.test(f))
  .filter((f) => !EXCLUDED_PATHS.some((p) => f.includes(p)))

const offenders = []
for (const file of tracked) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (!text.includes(EM_DASH)) continue

  text.split('\n').forEach((line, i) => {
    if (!line.includes(EM_DASH)) return
    // Chinese typography uses a double em dash and is left alone.
    if (line.includes(EM_DASH + EM_DASH)) return
    if (ALLOWED_LINES.includes(line.trim())) return
    offenders.push({file, line: i + 1, text: line.trim()})
  })
}

if (offenders.length === 0) {
  console.log(`check-prose: no em dashes in ${tracked.length} tracked files`)
  process.exit(0)
}

console.error(`check-prose: found ${offenders.length} em dash(es)\n`)
for (const o of offenders) {
  const snippet = o.text.length > 100 ? `${o.text.slice(0, 100)}...` : o.text
  console.error(`  ${o.file}:${o.line}`)
  console.error(`    ${snippet}\n`)
}
console.error('Use a comma, a colon, or parentheses instead.')
process.exit(1)
