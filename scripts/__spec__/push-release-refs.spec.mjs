import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'push-release-refs.sh'
)

// A git stand-in that records how it was called and what the key file looked
// like at push time, then exits with FAKE_GIT_EXIT. Plain strings, not a
// template literal, so bash's ${...} is never read as JavaScript.
const FAKE_GIT = [
  '#!/usr/bin/env bash',
  'key=""',
  'if [[ "$GIT_SSH_COMMAND" =~ -i\\ ([^ ]+) ]]; then key="${BASH_REMATCH[1]}"; fi',
  '{',
  '  echo "args=$*"',
  '  echo "ssh=$GIT_SSH_COMMAND"',
  '  echo "key=$key"',
  '  if [ -f "$key" ]; then',
  '    echo "key_exists=yes"',
  '    echo "key_body=$(cat "$key")"',
  '    echo "key_mode=$(stat -c %a "$key" 2>/dev/null || stat -f %Lp "$key")"',
  '  else',
  '    echo "key_exists=no"',
  '  fi',
  '} > "$FAKE_GIT_LOG"',
  'exit "${FAKE_GIT_EXIT:-0}"',
  ''
].join('\n')

function run(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-push-'))
  fs.writeFileSync(path.join(dir, 'git'), FAKE_GIT, {mode: 0o755})
  const log = path.join(dir, 'git.log')
  const result = spawnSync(
    'bash',
    [script, 'HEAD:refs/heads/main', 'refs/tags/v9.9.9'],
    {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
        GITHUB_REPOSITORY: 'extension-js/extension.js',
        FAKE_GIT_LOG: log,
        ...env
      }
    }
  )
  const called = fs.existsSync(log)
  const fields = called
    ? Object.fromEntries(
        fs
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => [
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1)
          ])
      )
    : {}

  return {result, called, fields}
}

const skip = process.platform === 'win32'

test('pushes the refspecs to the SSH remote with the key on disk only during the push', {
  skip
}, () => {
  const {result, called, fields} = run({RELEASE_DEPLOY_KEY: 'fake-private-key'})
  assert.equal(result.status, 0, result.stderr)
  assert.ok(called)
  assert.equal(
    fields.args,
    'push git@github.com:extension-js/extension.js.git HEAD:refs/heads/main refs/tags/v9.9.9'
  )

  assert.equal(fields.key_exists, 'yes')
  assert.equal(fields.key_body, 'fake-private-key')
  assert.equal(fields.key_mode, '600')
  assert.match(fields.ssh, /-o IdentitiesOnly=yes/)
  assert.match(fields.ssh, /-o StrictHostKeyChecking=yes/)
  assert.match(fields.ssh, /-o UserKnownHostsFile=\S+/)
  assert.equal(
    fs.existsSync(fields.key),
    false,
    'the key file must be gone after the push'
  )
})

test('removes the key file even when the push fails', {skip}, () => {
  const {result, fields} = run({
    RELEASE_DEPLOY_KEY: 'fake-private-key',
    FAKE_GIT_EXIT: '1'
  })
  assert.equal(result.status, 1)
  assert.equal(fs.existsSync(fields.key), false)
})

test('refuses to run without the deploy key and never calls git', {
  skip
}, () => {
  const {result, called} = run({RELEASE_DEPLOY_KEY: ''})
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /RELEASE_DEPLOY_KEY is not set/)
  assert.equal(called, false)
})
