import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {devLaunchVerdict} from '../lib/session-contract.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const smoke = path.join(root, 'scripts', 'nightly-dev-smoke.mjs')

const attached = {
  status: 'ready',
  browserPid: 4242,
  runtime: 'attached',
  executorAttachedAt: '2026-10-05T00:00:00.000Z'
}

test('a compile-ready contract is not a loaded extension', () => {
  assert.equal(devLaunchVerdict({status: 'ready'}).state, 'pending')
})

test('a spawned browser is not a loaded extension until the runtime attaches', () => {
  assert.equal(
    devLaunchVerdict({status: 'ready', browserPid: 4242}).state,
    'pending'
  )

  assert.equal(
    devLaunchVerdict({...attached, runtime: undefined}).state,
    'pending'
  )

  assert.equal(
    devLaunchVerdict({...attached, executorAttachedAt: undefined}).state,
    'pending'
  )
})

test('an attached runtime in a live session is a loaded extension', () => {
  assert.equal(devLaunchVerdict(attached).state, 'loaded')
})

test('a browser that exited fails the verdict, before or after the load', () => {
  const before = devLaunchVerdict({
    status: 'error',
    code: 'browser_exited',
    message: 'the edge process exited (code 1) before the extension loaded'
  })
  assert.equal(before.state, 'failed')
  assert.match(before.reason, /browser_exited/)

  const after = devLaunchVerdict({
    ...attached,
    browserExitedAt: '2026-10-05T00:00:01.000Z',
    browserExitCode: 1
  })
  assert.equal(after.state, 'failed')
  assert.match(after.reason, /code 1/)
})

// A stand-in for the CLI: writes the contract the way dev would for one
// scenario, then stays up until the smoke stops it, as a real dev session does.
const FAKE_CLI = `
const fs = require('node:fs')
const path = require('node:path')
const [, , , project, ...rest] = process.argv
const browser = rest[rest.indexOf('--browser') + 1]
const dir = path.join(project, 'dist', 'extension-js', browser)
fs.mkdirSync(dir, {recursive: true})
const base = {command: 'dev', browser, pid: process.pid, startedAt: new Date().toISOString()}
const write = (extra) => fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({...base, ...extra}))
const scenario = process.env.FAKE_SCENARIO
write({status: 'ready'})
setTimeout(() => {
  if (scenario === 'loaded') write({status: 'ready', browserPid: process.pid, runtime: 'attached', executorAttachedAt: new Date().toISOString()})
  if (scenario === 'spawned') write({status: 'ready', browserPid: process.pid})
  if (scenario === 'exited') write({status: 'error', code: 'browser_exited', message: 'the edge process exited (code 1) before the extension loaded, nothing is running', browserPid: process.pid, browserExitedAt: new Date().toISOString(), browserExitCode: 1})
  if (scenario === 'quits') process.exit(0)
}, 300)
setInterval(() => {}, 1000)
`

function runSmoke(scenario) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-dev-smoke-'))
  const cli = path.join(scratch, 'cli.cjs')
  fs.writeFileSync(cli, FAKE_CLI)

  try {
    return spawnSync(
      process.execPath,
      [smoke, path.join(scratch, 'project'), '--browser', 'edge', '--no-open'],
      {
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          FAKE_SCENARIO: scenario,
          NIGHTLY_SMOKE_CLI: cli,
          NIGHTLY_SMOKE_TIMEOUT_MS: '3000',
          NIGHTLY_SMOKE_HOLD_MS: '300'
        }
      }
    )
  } finally {
    fs.rmSync(scratch, {recursive: true, force: true})
  }
}

test('the smoke passes once the extension is attached in the browser', () => {
  const result = runSmoke('loaded')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /edge loaded the extension/)
})

test('the smoke fails when the browser exits before the extension loaded', () => {
  const result = runSmoke('exited')

  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, /FAILED for edge: .*browser_exited/)
})

test('the smoke fails when a browser spawned but the extension never attached', () => {
  const result = runSmoke('spawned')

  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, /no proof the extension loaded within 3000 ms/)
})

test('the smoke fails when dev exits 0 without loading anything', () => {
  const result = runSmoke('quits')

  assert.equal(result.status, 1, result.stdout)
  assert.match(
    result.stderr,
    /exited \(code 0, signal null\) before the extension loaded/
  )
})

function jobSection(text, job) {
  const start = text.indexOf(`\n  ${job}:\n`)
  assert.notEqual(start, -1, job)
  const rest = text.slice(start + 1)
  const end = rest.search(/\n {2}[a-z-]+:\n/)

  return end === -1 ? rest : rest.slice(0, end)
}

function stepRun(section, name) {
  const start = section.indexOf(`- name: ${name}`)
  assert.notEqual(start, -1, name)
  const rest = section.slice(start)
  const run = rest.match(/\n\s+run: (.+)\n/)
  assert.ok(run, name)

  return run[1]
}

const nightly = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'programs-nightly.yml'),
  'utf8'
)

for (const [job, step, browser] of [
  ['nightly-edge', 'Dev smoke – edge (Chromium)', 'edge'],
  ['nightly-firefox', 'Dev smoke – firefox (Gecko)', 'firefox']
]) {
  test(`the ${browser} dev smoke proves the load under an X server`, () => {
    const section = jobSection(nightly, job)
    const run = stepRun(section, step)

    assert.match(
      run,
      new RegExp(
        `^xvfb-run -a node scripts/nightly-dev-smoke\\.mjs templates/typescript --browser ${browser} `
      )
    )

    assert.ok(!run.includes('pnpm extension dev'), run)
    assert.ok(!run.includes('|| true'), run)
    assert.ok(!section.includes('continue-on-error'), job)
    assert.ok(!section.includes('EXTENSION_AUTO_EXIT_MS'), job)
    assert.match(
      section,
      /RED_LANE_REPRO:[\s\S]*xvfb-run -a node scripts\/nightly-dev-smoke\.mjs/
    )
  })
}

test('the firefox dev smoke runs on a profile the add-on can install into', () => {
  const run = stepRun(
    jobSection(nightly, 'nightly-firefox'),
    'Dev smoke – firefox (Gecko)'
  )

  assert.ok(!/--profile[ =]false/.test(run), run)
})

test('the runtime lanes call a launch a pass only on the attached verdict', () => {
  assert.match(
    jobSection(nightly, 'nightly-runtimes'),
    /run: pnpm smoke:\$\{\{ matrix\.runtime \}\}/
  )

  for (const runtime of ['bun', 'deno']) {
    const source = fs.readFileSync(
      path.join(root, 'scripts', `validate-${runtime}-runtime.mjs`),
      'utf8'
    )

    assert.match(source, /const verdict = devLaunchVerdict\(ready\)/, runtime)
    assert.match(
      source,
      /if \(verdict\.state === 'loaded'\) finish\(null, ready\)/,
      runtime
    )

    assert.ok(!/ready\.browserPid\) finish\(/.test(source), runtime)
    // Firefox on its own profile never installs the add-on, so the launch
    // must leave --profile false to Chromium.
    assert.match(
      source,
      /if \(!isGecko\(browser\)\) args\.push\('--profile', 'false'\)/,
      runtime
    )

    assert.ok(!source.includes("'--profile', 'false', '--no-open'"), runtime)
  }
})
