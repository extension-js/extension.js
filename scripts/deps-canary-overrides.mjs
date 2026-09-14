#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath, pathToFileURL} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT_DIR = path.resolve(path.dirname(__filename), '..')

// Each leg names the packages it tracks and the dist-tags that carry their
// prereleases. A candidate only becomes an override when one of those tags
// resolves to a version NEWER than the lockfile pin. A tag that fell behind
// the pin (rspack's `rc` sits at 2.2.0-rc.0 under a 2.2.x lock) would only
// downgrade the lane, so it is skipped and reported as such.
//
// `from` points at a different package when the upstream publishes its
// canaries under a separate scope. Rspack ships daily main builds as
// @rspack-canary/core, whose own dependency list already pins the matching
// @rspack-canary/binding, so @rspack/binding is deliberately not listed:
// an override there would break that exact-hash pairing.
export const LEGS = {
  'rspack-canary': [
    {name: '@rspack/core', from: '@rspack-canary/core', tags: ['latest']},
    {name: '@rspack/dev-server', tags: ['rc', 'beta', 'canary']},
    {name: '@rspack/plugin-react-refresh', tags: ['rc', 'beta', 'canary']},
    {name: '@rspack/plugin-preact-refresh', tags: ['rc', 'beta', 'canary']},
    {name: '@rslib/core', tags: ['rc', 'beta', 'canary', 'next']}
  ],
  'frameworks-next': [
    {name: 'react', tags: ['canary', 'next']},
    {name: 'react-dom', tags: ['canary', 'next']},
    {name: 'react-refresh', tags: ['canary', 'next']},
    {name: 'preact', tags: ['rc', 'beta']},
    {name: 'vue', tags: ['rc', 'beta', 'alpha']},
    {name: '@vue/compiler-sfc', tags: ['rc', 'beta', 'alpha']},
    {name: 'vue-loader', tags: ['next', 'beta']},
    {name: 'svelte', tags: ['next']}
  ],
  'typescript-next': [{name: 'typescript', tags: ['next', 'rc', 'beta']}]
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(
    String(version).trim()
  )
  if (!match) return null
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : []
  }
}

function compareIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

// Semver precedence without pulling a dependency into a CI-only script.
// Returns a negative number when `a` sorts before `b`.
export function compareVersions(a, b) {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) throw new Error(`cannot compare versions ${a} and ${b}`)
  for (let i = 0; i < 3; i++) {
    if (va.main[i] !== vb.main[i]) return Math.sign(va.main[i] - vb.main[i])
  }
  if (va.pre.length === 0 && vb.pre.length === 0) return 0
  if (va.pre.length === 0) return 1
  if (vb.pre.length === 0) return -1
  const length = Math.max(va.pre.length, vb.pre.length)
  for (let i = 0; i < length; i++) {
    if (va.pre[i] === undefined) return -1
    if (vb.pre[i] === undefined) return 1
    const order = compareIdentifiers(va.pre[i], vb.pre[i])
    if (order !== 0) return order
  }
  return 0
}

// The highest version of each package the lockfile resolved. The `packages:`
// section lists entries as `  name@version:` or `  'name@version(peers)':`.
// Only that section is read: the `overrides:` block at the top spells
// `  postcss-selector-parser@7: 7.1.5`, which is a range, not a pin.
export function readLockedVersions(lockfileText) {
  const locked = new Map()
  const entry = /^ {2}'?((?:@[^/'\s]+\/)?[^@'\s]+)@(\d+\.\d+\.\d+[^'(:\s]*)/
  let inPackages = false
  for (const line of lockfileText.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:')
      continue
    }
    if (!inPackages) continue
    const match = entry.exec(line)
    if (!match) continue
    const [, name, version] = match
    const current = locked.get(name)
    if (!current || compareVersions(version, current) > 0) {
      locked.set(name, version)
    }
  }
  return locked
}

// npm prints the tags as a bare object from a plain directory and wrapped in
// a one-element array from inside this workspace, so both shapes are read.
export function fetchDistTags(packageName) {
  const output = execFileSync(
    'npm',
    ['view', packageName, 'dist-tags', '--json'],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}
  )
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed[parsed.length - 1] || {} : parsed
}

// Picks, per candidate, the first tag in preference order whose version
// beats the lock pin. Tag order matters more than a version sort here:
// react's `next` and `canary` are both `19.3.0-canary-<hash>-<date>` and a
// semver sort would rank them by hash, not by date.
export function planOverrides(candidates, locked, distTagsFor) {
  const rows = []
  for (const candidate of candidates) {
    const source = candidate.from || candidate.name
    const lockedVersion = locked.get(candidate.name)
    if (!lockedVersion) {
      rows.push({
        ...candidate,
        source,
        status: 'skip',
        reason: 'not in the lockfile'
      })
      continue
    }
    let distTags = {}
    try {
      distTags = distTagsFor(source)
    } catch {
      rows.push({
        ...candidate,
        source,
        lockedVersion,
        status: 'skip',
        reason: 'npm view failed'
      })
      continue
    }
    let best = null
    for (const tag of candidate.tags) {
      const version = distTags[tag]
      if (!version || !parseVersion(version)) continue
      if (compareVersions(version, lockedVersion) <= 0) continue
      best = {tag, version}
      break
    }
    if (!best) {
      const seen = candidate.tags
        .filter((tag) => distTags[tag])
        .map((tag) => `${tag}=${distTags[tag]}`)
        .join(' ')
      rows.push({
        ...candidate,
        source,
        lockedVersion,
        status: 'skip',
        reason: seen
          ? `no tag newer than the pin (${seen})`
          : 'no prerelease tag published'
      })
      continue
    }
    const spec =
      source === candidate.name ? best.version : `npm:${source}@${best.version}`
    rows.push({
      ...candidate,
      source,
      lockedVersion,
      status: 'override',
      tag: best.tag,
      version: best.version,
      spec
    })
  }
  return rows
}

export function applyOverrides(packageJson, rows) {
  const next = structuredClone(packageJson)
  next.pnpm = next.pnpm || {}
  next.pnpm.overrides = {...(next.pnpm.overrides || {})}
  for (const row of rows) {
    if (row.status === 'override') next.pnpm.overrides[row.name] = row.spec
  }
  return next
}

export function renderTable(leg, rows) {
  const lines = [
    `### Dependency canary: ${leg}`,
    '',
    '| package | locked | prerelease | override |',
    '| --- | --- | --- | --- |'
  ]
  for (const row of rows) {
    const locked = row.lockedVersion || ''
    if (row.status === 'override') {
      lines.push(
        `| ${row.name} | ${locked} | ${row.source}@${row.tag} = ${row.version} | \`${row.spec}\` |`
      )
    } else {
      lines.push(`| ${row.name} | ${locked} | ${row.reason} | skipped |`)
    }
  }
  return lines.join('\n')
}

function appendOutput(file, text) {
  if (!file) return
  fs.appendFileSync(file, `${text}\n`)
}

export function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run')
  const leg = argv.find((arg) => !arg.startsWith('--'))
  if (!leg || !LEGS[leg]) {
    console.error(
      `usage: node scripts/deps-canary-overrides.mjs <${Object.keys(LEGS).join('|')}> [--dry-run]`
    )
    return 2
  }

  const lockfilePath = path.join(ROOT_DIR, 'pnpm-lock.yaml')
  const packageJsonPath = path.join(ROOT_DIR, 'package.json')
  const locked = readLockedVersions(fs.readFileSync(lockfilePath, 'utf8'))
  const rows = planOverrides(LEGS[leg], locked, fetchDistTags)
  const overrides = rows.filter((row) => row.status === 'override')

  const table = renderTable(leg, rows)
  console.log(table)
  appendOutput(process.env.GITHUB_STEP_SUMMARY, table)
  appendOutput(process.env.GITHUB_OUTPUT, `count=${overrides.length}`)
  appendOutput(
    process.env.GITHUB_OUTPUT,
    `packages=${overrides.map((row) => row.name).join(' ')}`
  )

  if (overrides.length === 0) {
    console.log(
      `\nNothing on ${leg} is ahead of the lockfile today, no override written.`
    )
    return 0
  }
  if (dryRun) return 0

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const next = applyOverrides(packageJson, rows)
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`\nWrote ${overrides.length} override(s) to package.json.`)
  return 0
}

if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).toString()
) {
  process.exitCode = main()
}
