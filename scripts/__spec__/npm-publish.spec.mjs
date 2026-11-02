import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'npm-publish.sh'
)

const TLOG =
  'npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log'

// A stand-in npm. `publish` takes its outcome per attempt from a plan, one
// line per attempt (ok, tlog, other), and `view` answers from a state file.
// It writes only to the paths the case passes in.
const STUB = `#!/usr/bin/env bash
if [ "$1" = "view" ]; then
  [ -f "$STUB_VISIBLE_FILE" ] && { echo 1.0.0; exit 0; }
  exit 1
fi
if [ "$1" = "publish" ]; then
  echo "publish $*" >> "$STUB_CALLS_FILE"
  n=$(wc -l < "$STUB_CALLS_FILE" | tr -d ' ')
  outcome=$(sed -n "\${n}p" "$STUB_PLAN_FILE")
  case "$outcome" in
    ok) : > "$STUB_VISIBLE_FILE"; exit 0 ;;
    tlog) printf '%s\\n' "$STUB_TLOG_TEXT"; [ "$STUB_TLOG_PUBLISHES" = 1 ] && : > "$STUB_VISIBLE_FILE"; exit 1 ;;
    *) echo "npm error code E403 forbidden"; exit 1 ;;
  esac
fi
exit 2
`

function run(plan, {tlogPublishes = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-publish-'))
  const bin = path.join(dir, 'bin')
  const pkg = path.join(dir, 'pkg')
  fs.mkdirSync(bin)
  fs.mkdirSync(pkg)
  fs.writeFileSync(path.join(bin, 'npm'), STUB, {mode: 0o755})
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({name: 'extension', version: '1.0.0'})
  )

  const planFile = path.join(dir, 'plan')
  const callsFile = path.join(dir, 'calls')
  fs.writeFileSync(planFile, `${plan.join('\n')}\n`)
  fs.writeFileSync(callsFile, '')

  try {
    const result = spawnSync('bash', [script, 'canary'], {
      cwd: pkg,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        NPM_PUBLISH_RETRY_WAIT: '0',
        STUB_PLAN_FILE: planFile,
        STUB_CALLS_FILE: callsFile,
        STUB_VISIBLE_FILE: path.join(dir, 'visible'),
        STUB_TLOG_TEXT: TLOG,
        STUB_TLOG_PUBLISHES: tlogPublishes ? '1' : '0'
      }
    })
    const calls = fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean)

    return {status: result.status, out: result.stdout + result.stderr, calls}
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
}

test('publishes once with provenance under the requested tag', () => {
  const {status, calls} = run(['ok'])

  assert.equal(status, 0)
  assert.deepEqual(calls, [
    'publish publish --access public --tag canary --provenance'
  ])
})

test('publishes again after a transparency log 409 while the version is absent', () => {
  const {status, calls, out} = run(['tlog', 'ok'])

  assert.equal(status, 0)
  assert.equal(calls.length, 2)
  assert.match(out, /publishing again/)
})

test('stops with npm status after the last attempt still hits the log error', () => {
  const {status, calls, out} = run(['tlog', 'tlog', 'ok'])

  assert.notEqual(status, 0)
  assert.equal(calls.length, 2)
  assert.match(out, /gh run rerun <run-id> --failed/)
})

test('does not retry any other failure', () => {
  const {status, calls} = run(['other', 'ok'])

  assert.notEqual(status, 0)
  assert.equal(calls.length, 1)
})

test('treats a version that reached npm despite the log error as published', () => {
  const {status, calls, out} = run(['tlog', 'ok'], {tlogPublishes: true})

  assert.equal(status, 0)
  assert.equal(calls.length, 1)
  assert.match(out, /is on npm despite/)
})
