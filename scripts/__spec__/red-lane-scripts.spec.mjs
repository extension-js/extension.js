import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

// A stand-in gh that records every call, answers the issue search with one
// open issue, and touches nothing on GitHub.
function runScript(script, ref) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'red-lane-'))
  const calls = path.join(scratch, 'calls.log')
  fs.writeFileSync(
    path.join(scratch, 'gh'),
    `#!/usr/bin/env bash\necho "$*" >> "${calls}"\nif [[ "$1 $2" == "issue list" ]]; then echo 779; fi\n`,
    {mode: 0o755}
  )

  try {
    const result = spawnSync(
      'bash',
      [path.join(root, 'scripts', script), 'Nightly edge'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${scratch}${path.delimiter}${process.env.PATH}`,
          GITHUB_REF: ref,
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'extension-js/extension.js',
          GITHUB_RUN_ID: '1',
          GITHUB_SHA: 'abc'
        }
      }
    )

    return {
      ...result,
      calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''
    }
  } finally {
    fs.rmSync(scratch, {recursive: true, force: true})
  }
}

for (const script of ['report-red-lane.sh', 'close-red-lane.sh']) {
  test(`${script} leaves the issue alone on a run of another branch`, () => {
    const result = runScript(script, 'refs/heads/fix/nightly-edge-launch')

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.calls, '')
    assert.match(result.stdout, /Not a run of main/)
  })

  test(`${script} acts on a run of main`, () => {
    const result = runScript(script, 'refs/heads/main')

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.calls, /^issue list /m)
    assert.match(
      result.calls,
      script === 'report-red-lane.sh'
        ? /^issue comment 779 /m
        : /^issue close 779 /m
    )
  })
}
