import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {
  assertLocalWorkspacePackagesExist,
  fileSpecifier,
  getLocalWorkspacePackagePaths,
  removeDirectoryWithRetries,
  resolveSmokeTempRootParent,
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

  assert.equal(
    specifier.startsWith('file:./') || specifier.startsWith('file:../'),
    true
  )
  assert.equal(specifier.includes('D:'), false)
})

test('fileSpecifier uses absolute file URL for cross-drive Windows paths', () => {
  setPlatform('win32')

  const targetPath = path.win32.resolve(
    'D:\\a\\extension.js\\extension.js\\programs\\create'
  )
  const specifier = fileSpecifier(
    targetPath,
    'C:\\Users\\runner\\AppData\\Local\\Temp\\fixture\\browser-extension'
  )

  assert.equal(
    specifier,
    'file:///D:/a/extension.js/extension.js/programs/create'
  )
})

test('getLocalWorkspacePackagePaths exposes every workspace package the fixture file-links', () => {
  const paths = getLocalWorkspacePackagePaths()

  assert.deepEqual(
    Object.keys(paths).sort(),
    ['create', 'develop', 'extension', 'install'],
    'If you renamed a programs/* package, update getLocalWorkspacePackagePaths() in scripts/run-optional-deps-smoke.mjs and keep this list in sync.'
  )

  for (const [name, dir] of Object.entries(paths)) {
    assert.equal(
      path.isAbsolute(dir),
      true,
      `${name} path should be absolute, got: ${dir}`
    )
  }
})

test('getLocalWorkspacePackagePaths entries resolve to real directories on disk', async () => {
  // Regression guard for commit 57457569 (programs/cli -> programs/extension):
  // stale hardcoded paths broke 5 CI smoke lanes with a cryptic pnpm error.
  // This test runs in the "Test optional deps smoke helpers" step, which
  // executes before the slow smoke lanes, so future renames fail fast and loud.
  const paths = getLocalWorkspacePackagePaths()

  for (const [name, dir] of Object.entries(paths)) {
    const stats = await fs.stat(dir)
    assert.equal(
      stats.isDirectory(),
      true,
      `${name} path should point at a directory: ${dir}`
    )

    const packageJsonPath = path.join(dir, 'package.json')
    await assert.doesNotReject(
      fs.access(packageJsonPath),
      `${name} package at ${dir} is missing package.json — is it still a workspace package?`
    )
  }
})

test('assertLocalWorkspacePackagesExist passes for the real workspace', async () => {
  await assert.doesNotReject(assertLocalWorkspacePackagesExist())
})

test('assertLocalWorkspacePackagesExist fails loudly when a path is missing', async () => {
  const paths = getLocalWorkspacePackagePaths()
  const broken = {
    ...paths,
    extension: path.join(paths.extension, '__does-not-exist__')
  }

  await assert.rejects(assertLocalWorkspacePackagesExist(broken), (error) => {
    assert.match(error.message, /extension/)
    assert.match(error.message, /not found/)
    assert.match(error.message, /getLocalWorkspacePackagePaths/)
    return true
  })
})

test('resolveSmokeTempRootParent keeps Windows smoke workspace on repo drive', async () => {
  setPlatform('win32')

  const tempParent = await resolveSmokeTempRootParent()

  assert.equal(tempParent.includes('.tmp'), true)
  assert.equal(
    path.win32.parse(tempParent).root.toLowerCase(),
    path.win32.parse(process.cwd()).root.toLowerCase()
  )
})
