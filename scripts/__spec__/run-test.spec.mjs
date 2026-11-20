import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

function writeExecutable(file, text) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text, {mode: 0o755})
}

// A copy of the runner in a tree whose bin folder holds only stand-ins, so
// no real turbo or package manager runs.
function makeTree({dotenvExit}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-test-'))
  const calls = path.join(base, 'calls.log')
  const record = (name, code) =>
    `#!/bin/sh\necho "${name} $*" >> "${calls}"\nexit ${code}\n`

  fs.mkdirSync(path.join(base, 'scripts/lib'), {recursive: true})
  fs.copyFileSync(
    path.join(root, 'scripts/run-test.mjs'),
    path.join(base, 'scripts/run-test.mjs')
  )

  fs.copyFileSync(
    path.join(root, 'scripts/lib/repo-bin-env.mjs'),
    path.join(base, 'scripts/lib/repo-bin-env.mjs')
  )

  fs.mkdirSync(path.join(base, 'node_modules'))
  fs.symlinkSync(
    fs.realpathSync(path.join(root, 'node_modules', 'cross-spawn')),
    path.join(base, 'node_modules', 'cross-spawn'),
    'dir'
  )

  if (dotenvExit !== undefined) {
    writeExecutable(
      path.join(base, 'node_modules/.bin/dotenv'),
      record('dotenv', dotenvExit)
    )
  }

  writeExecutable(path.join(base, 'bin/pnpm'), record('pnpm', 3))

  return {base, calls}
}

function runTarget(tree, target) {
  const result = spawnSync(
    process.execPath,
    [path.join(tree.base, 'scripts/run-test.mjs'), target],
    {
      encoding: 'utf8',
      env: {...process.env, PATH: path.join(tree.base, 'bin')}
    }
  )
  const calls = fs.existsSync(tree.calls)
    ? fs.readFileSync(tree.calls, 'utf8').trim().split('\n')
    : []

  return {...result, calls}
}

const runsShell = process.platform !== 'win32'

test('a turbo run that fails keeps its exit code and runs nothing else', {
  skip: !runsShell
}, () => {
  const tree = makeTree({dotenvExit: 2})

  try {
    const result = runTarget(tree, 'create')

    assert.equal(result.status, 2, result.stderr)
    assert.deepEqual(result.calls, [
      'dotenv -- turbo run test --filter ./programs/create'
    ])
  } finally {
    fs.rmSync(tree.base, {recursive: true, force: true})
  }
})

test('a runner that cannot start falls back to the package test', {
  skip: !runsShell
}, () => {
  const tree = makeTree({})

  try {
    const result = runTarget(tree, 'cli')

    assert.equal(result.status, 3, result.stderr)
    assert.deepEqual(result.calls, ['pnpm -C programs/extension test'])
  } finally {
    fs.rmSync(tree.base, {recursive: true, force: true})
  }
})
