#!/usr/bin/env node
// Inventory `_FUTURE/examples/examples/*` perf warnings.
//
// Runs `pnpm extension build <example>` against each example that has a
// manifest, captures combined stdout+stderr, and parses out the
// rspack/extension perf warnings (asset-size threshold + the rspack
// "performance recommendations" hint). Prints a single summary table at
// the end ranked by total over-threshold KiB.
//
// Usage:
//   node scripts/inventory-examples-perf-warnings.mjs
//   node scripts/inventory-examples-perf-warnings.mjs --browser=firefox
//   node scripts/inventory-examples-perf-warnings.mjs --only=content,content-react
//   EXTENSION_VERBOSE=1 node scripts/inventory-examples-perf-warnings.mjs

import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const EXAMPLES_DIR = path.join(ROOT, '_FUTURE', 'examples', 'examples')

const args = process.argv.slice(2)
const arg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const browser = arg('browser') || 'chromium'
const onlyArg = arg('only')
const onlySet = onlyArg
  ? new Set(
      onlyArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null
const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

function listExampleDirs() {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`Examples directory not found: ${EXAMPLES_DIR}`)
    process.exit(2)
  }
  const entries = fs.readdirSync(EXAMPLES_DIR, {withFileTypes: true})
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (onlySet && !onlySet.has(entry.name)) continue
    const dir = path.join(EXAMPLES_DIR, entry.name)
    // Only real extension projects: must have package.json AND a manifest
    // somewhere in src/ or the project root. Skip helper-only dirs.
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue
    const hasManifest =
      fs.existsSync(path.join(dir, 'manifest.json')) ||
      fs.existsSync(path.join(dir, 'src', 'manifest.json'))
    if (!hasManifest) continue
    out.push({name: entry.name, dir})
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// Parse a captured build output and extract perf-warning facts.
// The plugin-perf-budgets PerfBudgetWarning is the authoritative signal —
// rspack's stock single-threshold warning is disabled in rspack-config.ts,
// so the only "Build succeeded with N warning(s)" line that should fire
// for size-related issues comes from us.
function parseBuildOutput(text) {
  const hadBuildWarnLine = /Build succeeded with \d+ warning\(s\)/i.test(text)
  const hadAssetWarn =
    /exceed the extension performance budget/i.test(text) ||
    /asset size limit exceeded/i.test(text) || // legacy rspack pattern, kept for future-proofing
    /asset(s)? exceed the recommended size limit/i.test(text)
  const hadRecommendationWarn = /Rspack performance recommendations/i.test(text)
  const ok =
    /Build succeeded/i.test(text) ||
    /compiled successfully/i.test(text) ||
    /compiled with warnings/i.test(text)

  // Extract per-asset entries from the structured PerfBudgetWarning block:
  //
  //   <name>
  //     size:   470.0 KiB
  //     budget: 150.0 KiB  (over by 213%)
  //     role:   content script — injected on every page navigation
  //
  // Anchoring on `size:`/`budget:` pairs avoids the dist-tree false
  // positives where every emitted file is listed with its size.
  // Per-asset blocks may appear two ways:
  //   (a) raw warning text — entries on their own lines (\n separated)
  //   (b) routed through Extension.js' Performance formatter, which
  //       flattens to one line with `│` separators. Accept both.
  const oversized = []
  const blockRe =
    /([\w._/-]+\.(?:js|css|wasm))\s*[│|\n]+\s*size:\s*(\d+(?:\.\d+)?)\s*([KMG]i?B)\s*[│|\n]+\s*budget:\s*(\d+(?:\.\d+)?)\s*([KMG]i?B)/gi
  const toKiB = (val, unit) => {
    const u = String(unit).toLowerCase()
    if (u.startsWith('m')) return val * 1024
    if (u.startsWith('g')) return val * 1024 * 1024
    return val
  }
  let m
  while ((m = blockRe.exec(text)) !== null) {
    const asset = m[1]
    const sizeKiB = toKiB(parseFloat(m[2]), m[3])
    const budgetKiB = toKiB(parseFloat(m[4]), m[5])
    oversized.push({
      asset,
      kib: Math.round(sizeKiB * 100) / 100,
      budget: Math.round(budgetKiB * 100) / 100,
      kind: 'code'
    })
  }

  // Fallback for the legacy rspack warning shape (in case the plugin is
  // ever disabled and rspack's stock hint comes back).
  if (oversized.length === 0 && hadAssetWarn) {
    const legacyRe =
      /([^\s│|]+\.(?:js|css|wasm))\s*\((\d+(?:\.\d+)?)\s*([KMG]i?B)\)/gi
    let lm
    while ((lm = legacyRe.exec(text)) !== null) {
      const asset = lm[1]
      const sizeKiB = toKiB(parseFloat(lm[2]), lm[3])
      if (sizeKiB < 300) continue
      oversized.push({
        asset,
        kib: Math.round(sizeKiB * 100) / 100,
        budget: 300,
        kind: 'code'
      })
    }
  }

  const seen = new Set()
  const unique = []
  for (const o of oversized) {
    if (seen.has(o.asset)) continue
    seen.add(o.asset)
    unique.push(o)
  }
  unique.sort((a, b) => b.kib - a.kib)

  return {
    ok,
    hadAssetWarn,
    hadBuildWarnLine,
    hadRecommendationWarn,
    oversized: unique
  }
}

function fmtKiB(kib) {
  if (kib >= 1024) return `${(kib / 1024).toFixed(2)} MiB`
  return `${kib.toFixed(1)} KiB`
}

function buildOne({name, dir}) {
  const start = Date.now()
  const result = spawnSync(
    'pnpm',
    ['extension', 'build', dir, `--browser=${browser}`, '--no-telemetry'],
    {
      cwd: ROOT,
      env: {...process.env, FORCE_COLOR: '0', NO_COLOR: '1'},
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024
    }
  )
  const elapsed = Date.now() - start
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const combined = `${stdout}\n${stderr}`
  const status = result.status ?? -1
  const parsed = parseBuildOutput(combined)
  return {name, dir, status, elapsedMs: elapsed, parsed, combined}
}

function printSummary(results) {
  const failed = results.filter((r) => r.status !== 0 || !r.parsed.ok)
  const withWarn = results.filter(
    (r) =>
      r.status === 0 &&
      r.parsed.ok &&
      (r.parsed.hadAssetWarn ||
        r.parsed.hadBuildWarnLine ||
        r.parsed.oversized.length > 0)
  )
  const clean = results.filter(
    (r) =>
      r.status === 0 &&
      r.parsed.ok &&
      !r.parsed.hadAssetWarn &&
      !r.parsed.hadBuildWarnLine &&
      r.parsed.oversized.length === 0
  )

  const banner = (title) => `\n${'━'.repeat(72)}\n${title}\n${'━'.repeat(72)}`

  console.log(banner(`Inventory — browser=${browser}`))
  console.log(
    `Total: ${results.length}   Clean: ${clean.length}   With warnings: ${withWarn.length}   Failed: ${failed.length}`
  )

  if (withWarn.length > 0) {
    console.log(banner('Examples with perf warnings'))
    // Rank by largest single oversized asset so the worst offender is on top.
    const ranked = [...withWarn].sort((a, b) => {
      const aMax = a.parsed.oversized[0]?.kib || 0
      const bMax = b.parsed.oversized[0]?.kib || 0
      return bMax - aMax
    })
    for (const r of ranked) {
      const assets = r.parsed.oversized
      console.log(`  ${r.name}`)
      if (assets.length === 0) {
        console.log(
          `    → build emitted a warning but no perf-budget asset block matched`
        )
        continue
      }
      for (const a of assets) {
        console.log(
          `    ${a.asset}  ${fmtKiB(a.kib)} (budget ${fmtKiB(a.budget)})`
        )
      }
    }
  }

  if (failed.length > 0) {
    console.log(banner('Examples that failed to build'))
    for (const r of failed) {
      const tail = r.combined.trim().split('\n').slice(-6).join('\n      ')
      console.log(`  ${r.name}  (exit=${r.status})`)
      console.log(`      ${tail}`)
    }
  }

  if (clean.length > 0) {
    console.log(banner('Clean examples'))
    console.log(
      `  ${clean
        .map((r) => r.name)
        .reduce(
          (acc, name, i) =>
            i % 4 === 3
              ? `${acc}${name}\n  `
              : `${acc}${name}${i < clean.length - 1 ? ', ' : ''}`,
          ''
        )}`
    )
  }
}

function main() {
  const examples = listExampleDirs()
  if (examples.length === 0) {
    console.error('No examples found.')
    process.exit(1)
  }
  console.log(
    `Building ${examples.length} example(s) for browser=${browser}...`
  )

  const results = []
  let i = 0
  for (const ex of examples) {
    i++
    process.stdout.write(`[${i}/${examples.length}] ${ex.name} `)
    const r = buildOne(ex)
    const tag =
      r.status !== 0 || !r.parsed.ok
        ? 'FAIL'
        : r.parsed.hadAssetWarn || r.parsed.oversized.length > 0
          ? 'WARN'
          : 'OK'
    process.stdout.write(`[${tag}] ${r.elapsedMs}ms\n`)
    if (verbose && tag !== 'OK') {
      console.log(r.combined.split('\n').slice(-30).join('\n'))
    }
    results.push(r)
  }

  printSummary(results)
}

main()
