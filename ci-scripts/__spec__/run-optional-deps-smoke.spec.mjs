import test from 'node:test'
import assert from 'node:assert/strict'
import {
  removeDirectoryWithRetries,
  shouldRetryCleanupError
} from '../run-optional-deps-smoke.mjs'

test('shouldRetryCleanupError matches transient Windows cleanup errors', () => {
  assert.equal(shouldRetryCleanupError({code: 'EBUSY'}), true)
  assert.equal(shouldRetryCleanupError({code: 'EPERM'}), true)
  assert.equal(shouldRetryCleanupError({code: 'ENOTEMPTY'}), true)
  assert.equal(shouldRetryCleanupError({code: 'ENOENT'}), false)
  assert.equal(shouldRetryCleanupError(new Error('boom')), false)
})

test('removeDirectoryWithRetries retries transient cleanup failures', async () => {
  let attempts = 0

  await removeDirectoryWithRetries('/tmp/smoke-fixture', {
    maxAttempts: 4,
    baseDelayMs: 1,
    rm: async () => {
      attempts += 1
      if (attempts < 3) {
        const error = new Error('busy')
        error.code = 'EBUSY'
        throw error
      }
    }
  })

  assert.equal(attempts, 3)
})

test('removeDirectoryWithRetries surfaces non-retriable cleanup failures', async () => {
  let attempts = 0

  await assert.rejects(
    removeDirectoryWithRetries('/tmp/smoke-fixture', {
      maxAttempts: 4,
      baseDelayMs: 1,
      rm: async () => {
        attempts += 1
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      }
    }),
    /missing/
  )

  assert.equal(attempts, 1)
})
