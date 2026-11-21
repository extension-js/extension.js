import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  buildEntriesFor,
  missingBuildEntries,
  unbuiltDependencyLine,
  unbuiltWorkspaceDependencies,
  workspaceDependencyNames
} from '../ensure-workspace-deps.mjs'
import {requireBuiltWorkspaceDependencies} from '../lib/require-built-workspace-deps.mjs'

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

// A CLI package with one sibling, linked the way an install links it.
function workspace(t, {built, linked = true}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-unbuilt-deps-'))
  )

  t.after(() => fs.rmSync(root, {recursive: true, force: true}))

  const cli = path.join(root, 'programs', 'extension')
  const install = path.join(root, 'programs', 'install')

  fs.mkdirSync(path.join(cli, 'node_modules'), {recursive: true})
  fs.mkdirSync(install, {recursive: true})
  fs.writeFileSync(
    path.join(cli, 'package.json'),
    JSON.stringify({
      name: 'extension',
      dependencies: {'extension-install': 'workspace:*', commander: '^15.0.0'}
    })
  )

  fs.writeFileSync(
    path.join(install, 'package.json'),
    JSON.stringify({...INSTALL_MANIFEST, scripts: {compile: 'rslib build'}})
  )

  if (built) {
    fs.mkdirSync(path.join(install, 'dist'))
    fs.writeFileSync(path.join(install, 'dist', 'module.cjs'), '')
    fs.writeFileSync(path.join(install, 'dist', 'module.d.ts'), '')
  }

  if (linked) {
    fs.symlinkSync(
      install,
      path.join(cli, 'node_modules', 'extension-install'),
      'junction'
    )
  }

  return {root, cli, install}
}

test('a spec run with an unbuilt sibling stops at once, with one line that names the command', (t) => {
  const {root, cli} = workspace(t, {built: false})
  const [dependency] = unbuiltWorkspaceDependencies(cli)

  assert.equal(
    unbuiltDependencyLine(dependency, root),
    'workspace dependency extension-install has no build output (./dist/module.cjs). Run "pnpm -C programs/install run compile" first.'
  )

  assert.throws(
    () => requireBuiltWorkspaceDependencies(cli),
    (error) =>
      error instanceof Error &&
      error.message.split('\n').length === 1 &&
      error.message.includes('extension-install has no build output') &&
      error.message.includes('run compile') &&
      error.stack === error.message
  )
})

test('a spec run with every sibling built starts as before', (t) => {
  const {cli} = workspace(t, {built: true})

  assert.deepEqual(unbuiltWorkspaceDependencies(cli), [])
  assert.doesNotThrow(() => requireBuiltWorkspaceDependencies(cli))
})

test('a sibling no install linked is named with the install command', (t) => {
  const {cli} = workspace(t, {built: true, linked: false})

  assert.throws(
    () => requireBuiltWorkspaceDependencies(cli),
    /extension-install of extension is not linked\. Run "pnpm install" from the repository root\./
  )
})

// The guard only helps when the CLI suite runs it before any worker starts.
test('the CLI suite runs the guard as a global setup', () => {
  const config = fs
    .readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'programs',
        'extension',
        'vitest.config.ts'
      ),
      'utf8'
    )
    .replace(/\r\n/g, '\n')
  const setups = /globalSetup: \[([^\]]*)\]/.exec(config)?.[1] ?? ''

  assert.match(
    setups,
    /'\.\.\/\.\.\/scripts\/lib\/require-built-workspace-deps\.mjs'/
  )
})
