import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)
const turbo = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'turbo.cmd' : 'turbo'
)

test('the develop test task compiles the package once', () => {
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'programs/develop/package.json'),
      'utf8'
    )
  )
  const dry = spawnSync(
    turbo,
    ['run', 'test', '--filter', './programs/develop', '--dry=json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: {...process.env, TURBO_TELEMETRY_DISABLED: '1'}
    }
  )

  assert.equal(dry.status, 0, dry.stderr)

  const tasks = JSON.parse(dry.stdout).tasks.map((task) => task.taskId)

  // The package's own pretest compiles, so turbo must not compile it first.
  assert.match(pkg.scripts.pretest, /compile/)
  assert.deepEqual(
    tasks.filter((id) => id === 'extension-develop#compile'),
    []
  )

  assert.ok(tasks.includes('extension-develop#test'), tasks.join(', '))
})
