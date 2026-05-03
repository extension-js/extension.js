// Smoke run for the reload matrix harness.
//
// Runs the single most reproducible scenario the user reported (editing
// `_locales/en/messages.json` once in the action-locales fixture) so we can
// validate the harness end-to-end before scaling out to the full matrix.
//
// Output is intentionally human-readable: a per-extension-origin table of
// service-worker create/destroy counts and extension-page navigations,
// plus the raw event list with timestamps. The numbers in this table are
// the ground truth that future fixes have to move.

import {dirname, join, resolve} from 'node:path'
import {runScenario} from './harness.mjs'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const FIXTURE = join(
  REPO_ROOT,
  '_FUTURE/examples/examples/action-locales'
)

function bar(char = '─', n = 72) {
  return char.repeat(n)
}

function formatBuckets(buckets, userOrigin) {
  const rows = buckets
    .slice()
    .sort((a, b) => {
      if (a.origin === userOrigin) return -1
      if (b.origin === userOrigin) return 1
      return a.origin.localeCompare(b.origin)
    })
    .map((b) => {
      const role = b.origin === userOrigin ? 'user' : 'companion'
      return [
        `  ${b.origin}  (${role})`,
        `    serviceWorkerCreated:    ${b.serviceWorkerCreated}`,
        `    serviceWorkerDestroyed:  ${b.serviceWorkerDestroyed}`,
        `    extensionPageNavigated:  ${b.extensionPageNavigated}`
      ].join('\n')
    })
  if (rows.length === 0) return '  (no extension-origin events)'
  return rows.join('\n')
}

function formatEvent(event, indexBase) {
  const ts = event.timestamp.toFixed(1).padStart(8)
  const cat = event.category.padEnd(26)
  const origin = event.extensionOrigin
    ? `${event.extensionOrigin.slice(0, 8)}…`
    : '            '
  const detail =
    event.targetUrl ||
    event.frameUrl ||
    event.contextOrigin ||
    event.contextName ||
    ''
  return `  ${String(indexBase).padStart(3)}  ${ts}ms  ${cat}  ${origin}  ${detail}`
}

async function main() {
  console.log(bar())
  console.log('reload-matrix smoke run')
  console.log(bar())
  console.log(`fixture: ${FIXTURE}`)
  console.log(`scenario: edit _locales/en/messages.json once, popup closed`)
  console.log()

  const result = await runScenario({
    name: 'locales-single-edit-popup-closed',
    fixturePath: FIXTURE,
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform(current) {
          // Toggle a known message field's value. We pick the title because
          // it appears in fixtures we control and the change is harmless.
          return current.replace(
            /"message":\s*"Welcome[^"]*"/,
            '"message": "Welcome (matrix run)"'
          )
        },
        waitMsAfter: 200
      }
    ],
    startupQuietMs: 1_500,
    afterEditsQuietMs: 2_500
  })

  console.log(`user manifest name: ${result.userManifestName ?? '(unknown)'}`)
  console.log(`detected user origin: ${result.userOrigin ?? '(unresolved)'}`)
  console.log()

  console.log('baseline (events before the first edit):')
  console.log(formatBuckets(result.baselineBuckets, result.userOrigin))
  console.log()

  console.log('per-edit deltas (events after the first edit):')
  console.log(formatBuckets(result.buckets, result.userOrigin))
  console.log()

  console.log(`raw event timeline (${result.events.length} events):`)
  result.events.forEach((event, i) => {
    console.log(formatEvent(event, i))
  })
  console.log()

  console.log(bar())
  console.log('summary')
  console.log(bar())
  const userBucket = result.buckets.find((b) => b.origin === result.userOrigin)
  if (!userBucket) {
    console.log('NO user-extension events captured. Harness needs adjustment.')
    process.exit(2)
  }
  console.log(
    `user extension SW restarts (created+destroyed÷2 ≈ restart count): ` +
      `${Math.min(userBucket.serviceWorkerCreated, userBucket.serviceWorkerDestroyed)}`
  )
  console.log(
    `user extension SW first-time creations (no prior destroy): ` +
      `${Math.max(0, userBucket.serviceWorkerCreated - userBucket.serviceWorkerDestroyed)}`
  )
  console.log(
    `user extension page navigations (popup/options/etc): ` +
      `${userBucket.extensionPageNavigated}`
  )
}

main().catch(async (err) => {
  console.error('smoke run failed:', err)
  if (err && err.stdoutTail) {
    console.error('--- dev stdout (last lines) ---')
    console.error(err.stdoutTail)
  }
  if (err && err.stderrTail) {
    console.error('--- dev stderr (last lines) ---')
    console.error(err.stderrTail)
  }
  process.exit(1)
})
