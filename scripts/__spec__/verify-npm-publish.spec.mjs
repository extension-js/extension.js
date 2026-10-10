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
  'verify-npm-publish.sh'
)

// A stand-in npm: `view` answers from an explicit state file, `publish` prints
// what the case asks and can make the version visible. It writes only to the
// state file path the case passes in.
const STUB = `#!/usr/bin/env bash
if [ "$1" = "view" ]; then
  [ -f "$STUB_VISIBLE_FILE" ] && { echo 1.0.0-canary.1; exit 0; }
  exit 1
fi
if [ "$1" = "publish" ]; then
  echo "publish $*" >> "$STUB_CALLS_FILE"
  printf '%s\\n' "$STUB_PUBLISH_OUTPUT"
  [ "$STUB_PUBLISH_MAKES_VISIBLE" = 1 ] && : > "$STUB_VISIBLE_FILE"
  exit "$STUB_PUBLISH_STATUS"
fi
exit 2
`

function run({visible = false, output = '', status = 0, makesVisible = false}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-npm-publish-'))
  const bin = path.join(dir, 'bin')
  const pkg = path.join(dir, 'pkg')
  fs.mkdirSync(bin)
  fs.mkdirSync(pkg)
  fs.writeFileSync(path.join(bin, 'npm'), STUB, {mode: 0o755})
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({name: 'extension-develop', version: '1.0.0-canary.1'})
  )

  const visibleFile = path.join(dir, 'visible')
  const callsFile = path.join(dir, 'calls')
  if (visible) fs.writeFileSync(visibleFile, '')

  try {
    const result = spawnSync('bash', [script, 'canary'], {
      cwd: pkg,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        VERIFY_NPM_POLLS: '2',
        VERIFY_NPM_INTERVAL: '0',
        STUB_VISIBLE_FILE: visibleFile,
        STUB_CALLS_FILE: callsFile,
        STUB_PUBLISH_OUTPUT: output,
        STUB_PUBLISH_STATUS: String(status),
        STUB_PUBLISH_MAKES_VISIBLE: makesVisible ? '1' : '0'
      }
    })
    const calls = fs.existsSync(callsFile)
      ? fs.readFileSync(callsFile, 'utf8').trim().split('\n')
      : []

    return {...result, calls}
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
}

test('passes as soon as the version is visible, without publishing again', () => {
  const result = run({visible: true})
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.calls, [])
})

test('names a staged version and tells the maintainer what to do', () => {
  const result = run({
    output:
      'npm error 409 Conflict - PUT https://registry.npmjs.org/extension-develop - Cannot publish over previously staged version "1.0.0-canary.1".',
    status: 1
  })
  assert.equal(result.status, 1)
  assert.match(
    result.stdout,
    /::error::npm staged extension-develop@1\.0\.0-canary\.1/
  )

  assert.match(result.stdout, /Approve it on npmjs\.com/)
  assert.deepEqual(result.calls, [
    'publish publish --access public --tag canary --provenance'
  ])
})

test('publishes once more when a version went missing, then passes', () => {
  const result = run({
    output: '+ extension-develop@1.0.0-canary.1',
    makesVisible: true
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.calls.length, 1)
})

test('fails plainly when the second publish fails for another reason', () => {
  const result = run({output: 'npm error 403 Forbidden', status: 1})
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Publish not visible on npm after waiting/)
  assert.doesNotMatch(result.stdout, /::error::npm staged/)
})
