import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {
  fileSpecifier,
  removeDirectoryWithRetries,
  shouldUseRegistryExtensionForSmoke,
  shouldRetryCleanupError
} from '../run-optional-deps-smoke.mjs'

const originalPlatform = process.platform

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true
  })
}

test.after(() => {
  setPlatform(originalPlatform)
})

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

test('shouldUseRegistryExtensionForSmoke keeps pnpm aligned with source-under-test', () => {
  assert.equal(shouldUseRegistryExtensionForSmoke('pnpm'), false)
  assert.equal(shouldUseRegistryExtensionForSmoke('npm'), false)
  assert.equal(shouldUseRegistryExtensionForSmoke('yarn'), true)
  assert.equal(shouldUseRegistryExtensionForSmoke('bun'), true)
})

test('fileSpecifier keeps same-drive Windows paths relative', () => {
  setPlatform('win32')

  const specifier = fileSpecifier(
    'C:\\repo\\extension.js\\programs\\create',
    'C:\\Users\\runner\\AppData\\Local\\Temp\\fixture\\browser-extension'
  )

  assert.equal(specifier.startsWith('file:./') || specifier.startsWith('file:../'), true)
  assert.equal(specifier.includes('D:'), false)
})

test('fileSpecifier uses absolute file URL for cross-drive Windows paths', () => {
  setPlatform('win32')

  const targetPath = path.win32.resolve('D:\\a\\extension.js\\extension.js\\programs\\create')
  const specifier = fileSpecifier(
    targetPath,
    'C:\\Users\\runner\\AppData\\Local\\Temp\\fixture\\browser-extension'
  )

  assert.equal(specifier, pathToFileURL(targetPath).toString())
})
