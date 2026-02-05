#!/usr/bin/env node
// Sync between:
// - programs/develop/webpack/webpack-lib/build-dependencies.json (runtime source of truth)
// - .github/build-deps/package.json (Dependabot + GH dependency graph tracking)
//
// Usage:
//   node scripts/sync-build-deps-tracking.mjs            # forward: build-dependencies.json -> tracking package.json
//   node scripts/sync-build-deps-tracking.mjs --reverse  # reverse: tracking package.json -> build-dependencies.json

import * as fs from 'fs'
import * as path from 'path'
import {execSync} from 'node:child_process'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const repoRoot = path.resolve(__dirname, '..')
const buildDepsPath = path.join(
  repoRoot,
  'programs/develop/webpack/webpack-lib/build-dependencies.json'
)
const trackingPkgPath = path.join(
  repoRoot,
  '.github/build-deps/package.json'
)

const args = new Set(process.argv.slice(2))
const isReverseArg = args.has('--reverse')
const isAuto = args.has('--auto')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function assertNoForbiddenDeps(deps, label) {
  // Guardrails: the tracking manifest is *only* for runtime "installOwnDependencies"
  // deps. Never allow test/build tooling to leak in here.
  const forbiddenExact = new Set([
    // test runners / test utils
    'vitest',
    'jest',
    'playwright',
    // toolchains
    'typescript',
    'tsup',
    '@rslib/core',
    // linters/formatters
    'eslint',
    'prettier'
  ])

  const forbiddenPrefixes = ['@types/']

  const bad = Object.keys(deps).filter((k) => {
    if (forbiddenExact.has(k)) return true
    return forbiddenPrefixes.some((p) => k.startsWith(p))
  })

  if (bad.length > 0) {
    console.error(
      `Forbidden dependencies found in ${label}: ${bad.join(', ')}\n` +
        'These should not be tracked as build/runtime deps.'
    )
    process.exit(1)
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n')
}

function sortObjectKeys(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => {
      acc[k] = obj[k]
      return acc
    }, {})
}

function detectChangedFiles(baseSha, headSha) {
  if (!baseSha || !headSha) return new Set()

    try {
    const output = execSync(`git diff --name-only ${baseSha} ${headSha}`, {
      cwd: repoRoot,
      encoding: 'utf-8'
    })
    const files = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return new Set(files)
  } catch (error) {
    console.warn(
      'Warning: unable to detect changed files via git diff. Falling back to forward sync.'
    )

    return new Set()
  }
}

function resolveSyncDirection() {
  if (isReverseArg) return 'reverse'
  if (!isAuto) return 'forward'

  // Auto mode: if only the tracking manifest changed, prefer reverse sync.
  const baseSha = process.env.SYNC_BASE
  const headSha = process.env.SYNC_HEAD
  const changed = detectChangedFiles(baseSha, headSha)

  const buildDepsRel = path.relative(repoRoot, buildDepsPath)
  const trackingRel = path.relative(repoRoot, trackingPkgPath)

  const trackingChanged = changed.has(trackingRel)
  const buildDepsChanged = changed.has(buildDepsRel)

  if (trackingChanged && !buildDepsChanged) {
    return 'reverse'
  }

  return 'forward'
}

if (!fs.existsSync(buildDepsPath)) {
  console.error(`Missing build deps file: ${buildDepsPath}`)
  process.exit(1)
}

if (!fs.existsSync(trackingPkgPath)) {
  console.error(`Missing tracking package.json: ${trackingPkgPath}`)
  process.exit(1)
}

const syncDirection = resolveSyncDirection()
const isReverse = syncDirection === 'reverse'

if (isAuto) {
  console.log(`Auto sync direction: ${syncDirection}`)
}

if (!isReverse) {
  const buildDeps = readJson(buildDepsPath)
  const trackingPkg = readJson(trackingPkgPath)

  assertNoForbiddenDeps(buildDeps, 'build-dependencies.json')
  trackingPkg.dependencies = sortObjectKeys(buildDeps)
  trackingPkg.name = trackingPkg.name || 'extension-develop-build-deps'
  trackingPkg.private = true
  trackingPkg.version = trackingPkg.version || '0.0.0'

  writeJson(trackingPkgPath, trackingPkg)
  console.log(
    `✓ Synced ${Object.keys(buildDeps).length} deps to .github/build-deps/package.json`
  )
} else {
  const trackingPkg = readJson(trackingPkgPath)
  const deps = trackingPkg?.dependencies || {}

  if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
    console.error('Invalid tracking package.json: dependencies must be an object')
    process.exit(1)
  }

  assertNoForbiddenDeps(deps, '.github/build-deps/package.json')
  const sortedDeps = sortObjectKeys(deps)
  writeJson(buildDepsPath, sortedDeps)
  console.log(
    `✓ Synced ${Object.keys(sortedDeps).length} deps to build-dependencies.json`
  )
}

