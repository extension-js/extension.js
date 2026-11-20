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

// The release-age rule is a supply-chain guard, so its value and every
// exclusion are pinned, and create must read the file the rule lives in.
test('the release-age rule lives in pnpm-workspace.yaml, where create reads it', () => {
  const workspace = readYaml('pnpm-workspace.yaml')

  assert.deepEqual(npmrcKeys(), [])
  assert.equal(workspace.minimumReleaseAge, 4320)
  assert.deepEqual(workspace.minimumReleaseAgeExclude, [
    'image-size',
    'browser-extension-manifest-fields',
    'zen-location',
    'floorp-location',
    'firefox-location2'
  ])

  assert.match(
    fs.readFileSync(
      path.join(root, 'programs', 'create', 'lib', 'install-runner.ts'),
      'utf8'
    ),
    /'pnpm-workspace\.yaml'/
  )
})
