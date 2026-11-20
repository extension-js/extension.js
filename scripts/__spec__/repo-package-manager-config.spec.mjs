import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {readYaml} from '../lib/workflow-yaml.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

function npmrcKeys() {
  return fs
    .readFileSync(path.join(root, '.npmrc'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].replace(/\[\]$/, ''))
}

// npm reads .npmrc too and warns on every call for a key it does not know.
test('the pnpm-only settings live in pnpm-workspace.yaml', () => {
  const workspace = readYaml('pnpm-workspace.yaml')

  assert.equal(workspace.autoInstallPeers, true)
  assert.equal(workspace.strictPeerDependencies, false)
  assert.equal(workspace.ignoreWorkspaceRootCheck, true)

  for (const key of [
    'auto-install-peers',
    'strict-peer-dependencies',
    'ignore-workspace-root-check'
  ]) {
    assert.ok(!npmrcKeys().includes(key), key)
  }
})

// The create install runner finds the inherited rule by reading .npmrc, so the
// rule moves only together with that reader.
test('the release-age rule stays in .npmrc, where create reads it', () => {
  const workspace = readYaml('pnpm-workspace.yaml')

  assert.deepEqual([...new Set(npmrcKeys())].sort(), [
    'minimum-release-age',
    'minimum-release-age-exclude'
  ])

  assert.equal(workspace.minimumReleaseAge, undefined)
  assert.equal(workspace.minimumReleaseAgeExclude, undefined)
  assert.match(
    fs.readFileSync(
      path.join(root, 'programs', 'create', 'lib', 'install-runner.ts'),
      'utf8'
    ),
    /'\.npmrc'/
  )
})
