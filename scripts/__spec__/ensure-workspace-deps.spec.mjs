import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  buildEntriesFor,
  missingBuildEntries,
  workspaceDependencyNames
} from '../ensure-workspace-deps.mjs'

const CLI_MANIFEST = {
  name: 'extension',
  dependencies: {
    'extension-create': 'workspace:*',
    'extension-develop': 'workspace:*',
    'extension-install': 'workspace:*',
    commander: '^15.0.0'
  },
  devDependencies: {vitest: '^5.0.0', tsconfig: '*'}
}

const INSTALL_MANIFEST = {
  name: 'extension-install',
  main: './dist/module.cjs',
  types: './dist/module.d.ts',
  exports: {'.': {import: './dist/module.cjs', require: './dist/module.cjs'}}
}

const DEVELOP_MANIFEST = {
  name: 'extension-develop',
  main: './dist/module.mjs',
  exports: {
    '.': {import: './dist/module.mjs'},
    './contract/*': './dist/contract/*'
  }
}

test('workspace ranges are the only dependencies this guard owns', () => {
  assert.deepEqual(workspaceDependencyNames(CLI_MANIFEST), [
    'extension-create',
    'extension-develop',
    'extension-install'
  ])
})

test('a package with no workspace dependency asks for nothing', () => {
  assert.deepEqual(workspaceDependencyNames(INSTALL_MANIFEST), [])
})

test('build entries come from main, types and every exports subpath', () => {
  assert.deepEqual(buildEntriesFor(INSTALL_MANIFEST), [
    './dist/module.cjs',
    './dist/module.d.ts'
  ])
})

test('a subpath pattern is checked as the folder that holds its matches', () => {
  assert.deepEqual(buildEntriesFor(DEVELOP_MANIFEST), [
    './dist/module.mjs',
    './dist/contract'
  ])
})

test('RED: a sibling whose dist was never built reports its missing entry', () => {
  const missing = missingBuildEntries({
    manifest: INSTALL_MANIFEST,
    exists: () => false
  })

  assert.deepEqual(missing, ['./dist/module.cjs', './dist/module.d.ts'])
})

test('GREEN: a built sibling is a no-op, so pnpm test stays fast', () => {
  const missing = missingBuildEntries({
    manifest: DEVELOP_MANIFEST,
    exists: () => true
  })

  assert.deepEqual(missing, [])
})

test('a half-built sibling reports only the entry that is absent', () => {
  const missing = missingBuildEntries({
    manifest: INSTALL_MANIFEST,
    exists: (entry) => entry === './dist/module.cjs'
  })

  assert.deepEqual(missing, ['./dist/module.d.ts'])
})
