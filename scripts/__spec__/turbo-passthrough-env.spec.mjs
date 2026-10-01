import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const turbo = JSON.parse(readFileSync(join(repoRoot, 'turbo.json'), 'utf8'))

// Turbo prunes the environment, and os.tmpdir() falls back to the shared /tmp
// when TMPDIR is gone. That made every spec write its fixtures somewhere other
// than a direct `vitest run` does, so a suite could pass on its own and fail
// through turbo for reasons nothing in the task could explain.
test('turbo passes TMPDIR through to tasks', () => {
  assert.ok(
    Array.isArray(turbo.globalPassThroughEnv),
    'turbo.json needs a globalPassThroughEnv array'
  )

  assert.ok(
    turbo.globalPassThroughEnv.includes('TMPDIR'),
    'TMPDIR must be passed through so turbo tasks and direct runs share one temp dir'
  )
})

// Pass-through, not globalEnv: TMPDIR differs per machine and per login
// session, so hashing it would miss the cache on every run.
test('TMPDIR is not part of the cache key', () => {
  const globalEnv = Array.isArray(turbo.globalEnv) ? turbo.globalEnv : []

  assert.ok(!globalEnv.includes('TMPDIR'))
})
