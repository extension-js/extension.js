import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

function isIgnored(file) {
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', '--no-index', '--', file],
    {
      cwd: repoRoot
    }
  )

  return result.status === 0
}

test('a declaration a compile drops beside a source is never stageable', () => {
  for (const file of [
    'programs/develop/lib/new-module.d.ts',
    'programs/develop/plugin-css/css-lib/new-helper.d.ts',
    'programs/extension/commands/new-command.d.ts',
    'programs/create/lib/new-step.d.ts',
    'programs/install/lib/new-module.d.ts'
  ]) {
    assert.equal(isIgnored(file), true, `${file} should be ignored`)
  }
})

test('every declaration the repository ships stays tracked', () => {
  const tracked = spawnSync('git', ['ls-files', '--', 'programs'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .stdout.split('\n')
    .filter((file) => file.endsWith('.d.ts'))

  assert.ok(tracked.length > 0)

  for (const file of tracked) {
    assert.equal(isIgnored(file), false, `${file} must not be ignored`)
  }
})
