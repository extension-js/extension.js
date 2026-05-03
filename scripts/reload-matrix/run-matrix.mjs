// Run the full reload matrix. Each scenario runs `repeat` times; a scenario
// passes only if all repetitions are within the expected bounds. The output
// is a fixed-width table that's easy to compare across runs.
//
// Modes:
//   RELOAD_MATRIX_MODE=local  (default) → run against the local CLI build at
//                                         <repo>/programs/extension/dist/cli.cjs.
//   RELOAD_MATRIX_MODE=remote          → run against `npx -y extension@<tag>`,
//                                         where <tag> is RELOAD_MATRIX_TAG
//                                         (default `canary`). Use this after
//                                         a canary publish to verify the
//                                         shipped artifacts behave the same
//                                         as the local build.

import {SCENARIOS} from './scenarios.mjs'
import {runScenario} from './harness.mjs'

const REPEAT = Number(process.env.RELOAD_MATRIX_REPEAT || '3')
const FILTER = process.env.RELOAD_MATRIX_FILTER
const MODE = process.env.RELOAD_MATRIX_MODE || 'local'
const REMOTE_TAG = process.env.RELOAD_MATRIX_TAG || 'canary'

function bar(char = '─', n = 88) {
  return char.repeat(n)
}

function pickUserBucket(result) {
  return result.buckets.find((b) => b.origin === result.userOrigin)
}

function summarize(result) {
  const bucket = pickUserBucket(result)
  if (!bucket) return {sw: 0, nav: 0}
  const sw = Math.min(
    bucket.serviceWorkerCreated,
    bucket.serviceWorkerDestroyed
  )
  return {sw, nav: bucket.extensionPageNavigated}
}

function evaluate(observed, expected) {
  const issues = []
  if (typeof expected.serviceWorkerRestarts === 'number') {
    if (observed.sw !== expected.serviceWorkerRestarts) {
      issues.push(
        `serviceWorkerRestarts: expected ${expected.serviceWorkerRestarts}, got ${observed.sw}`
      )
    }
  }
  if (typeof expected.serviceWorkerRestartsAtMost === 'number') {
    if (observed.sw > expected.serviceWorkerRestartsAtMost) {
      issues.push(
        `serviceWorkerRestarts: expected at most ${expected.serviceWorkerRestartsAtMost}, got ${observed.sw}`
      )
    }
  }
  if (typeof expected.extensionPageNavigations === 'number') {
    if (observed.nav !== expected.extensionPageNavigations) {
      issues.push(
        `extensionPageNavigations: expected ${expected.extensionPageNavigations}, got ${observed.nav}`
      )
    }
  }
  if (typeof expected.extensionPageNavigationsAtMost === 'number') {
    if (observed.nav > expected.extensionPageNavigationsAtMost) {
      issues.push(
        `extensionPageNavigations: expected at most ${expected.extensionPageNavigationsAtMost}, got ${observed.nav}`
      )
    }
  }
  return issues
}

function expectedSpec(expected) {
  const parts = []
  if ('serviceWorkerRestarts' in expected)
    parts.push(`sw=${expected.serviceWorkerRestarts}`)
  if ('serviceWorkerRestartsAtMost' in expected)
    parts.push(`sw≤${expected.serviceWorkerRestartsAtMost}`)
  if ('extensionPageNavigations' in expected)
    parts.push(`nav=${expected.extensionPageNavigations}`)
  if ('extensionPageNavigationsAtMost' in expected)
    parts.push(`nav≤${expected.extensionPageNavigationsAtMost}`)
  return parts.join(' ')
}

async function main() {
  console.log(bar())
  const modeLabel = MODE === 'remote' ? `remote(${REMOTE_TAG})` : 'local'
  console.log(
    `reload matrix · ${SCENARIOS.length} scenarios × ${REPEAT} repeats · mode=${modeLabel}` +
      (FILTER ? ` · filter=${FILTER}` : '')
  )
  console.log(bar())

  const results = []
  for (const scenario of SCENARIOS) {
    if (FILTER && !scenario.name.includes(FILTER)) continue
    const reps = []
    for (let i = 0; i < REPEAT; i++) {
      try {
        const result = await runScenario({
          ...scenario,
          mode: scenario.mode || MODE,
          remoteTag: scenario.remoteTag || REMOTE_TAG
        })
        reps.push(summarize(result))
      } catch (err) {
        reps.push({error: err.message})
      }
    }
    const failures = []
    for (const [i, rep] of reps.entries()) {
      if (rep.error) {
        failures.push(`run ${i + 1}: ${rep.error}`)
        continue
      }
      const issues = evaluate(rep, scenario.expected)
      if (issues.length) failures.push(`run ${i + 1}: ${issues.join('; ')}`)
    }
    results.push({scenario, reps, failures})

    const observedColumn = reps
      .map((r) => (r.error ? 'ERR' : `sw=${r.sw} nav=${r.nav}`))
      .join('  ')
    const status = failures.length === 0 ? 'OK' : 'FAIL'
    console.log(
      `  [${status.padEnd(4)}]  ${scenario.name.padEnd(38)}  ${observedColumn}`
    )
    for (const failure of failures) {
      console.log(`           ↳ ${failure}`)
    }
  }

  const failed = results.filter((r) => r.failures.length > 0)
  console.log(bar())
  console.log(`pass: ${results.length - failed.length}  fail: ${failed.length}`)
  for (const result of results) {
    if (result.failures.length === 0) continue
    console.log(`\n${result.scenario.name}: expected ${expectedSpec(result.scenario.expected)}`)
    for (const f of result.failures) console.log(`  ${f}`)
  }
  console.log(bar())

  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('matrix runner crashed:', err)
  process.exit(2)
})
