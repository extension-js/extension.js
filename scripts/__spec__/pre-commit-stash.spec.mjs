import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const wrapper = path.join(repoRoot, 'scripts', 'pre-commit-lint-staged.mjs')

function git(cwd, args, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {...process.env, ...env}
  })

  assert.equal(result.status, 0, result.stderr)

  return result.stdout
}

function stashList(cwd) {
  return git(cwd, ['stash', 'list', '--format=%gs']).trim()
}

function backupRefs(cwd) {
  return git(cwd, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/lint-staged-backups'
  ]).trim()
}

function makeRepo(task) {
  const dir = mkdtempSync(path.join(tmpdir(), 'extjs-pre-commit-'))

  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'spec@example.com'])
  git(dir, ['config', 'user.name', 'spec'])
  writeFileSync(
    path.join(dir, '.lintstagedrc.json'),
    JSON.stringify({'*.txt': [`node -e ${JSON.stringify(task)}`]})
  )

  writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
  writeFileSync(path.join(dir, 'keep.txt'), 'someone else\n')
  git(dir, ['stash', 'push', '-q', '-u', '-m', 'another session'])
  writeFileSync(path.join(dir, 'a.txt'), 'a\nb\n')
  git(dir, ['add', 'a.txt'])

  return dir
}

function runHook(dir) {
  return spawnSync(process.execPath, [wrapper], {cwd: dir, encoding: 'utf8'})
}

test('the pre-commit hook runs lint-staged through the wrapper', () => {
  const hook = readFileSync(path.join(repoRoot, '.husky', 'pre-commit'), 'utf8')

  assert.match(hook, /node scripts\/pre-commit-lint-staged\.mjs/)
})

test('a failing task keeps the stash list and the unstaged half of a file', () => {
  const dir = makeRepo('process.exit(1)')

  try {
    writeFileSync(path.join(dir, 'a.txt'), 'a\nb\nunstaged\n')

    const before = stashList(dir)
    const result = runHook(dir)

    assert.notEqual(result.status, 0)
    assert.equal(stashList(dir), before)
    assert.equal(
      readFileSync(path.join(dir, 'a.txt'), 'utf8'),
      'a\nb\nunstaged\n'
    )

    assert.equal(git(dir, ['show', ':a.txt']), 'a\nb\n')
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test('a hook stopped mid-task moves its backup off the shared stash list', {
  skip: process.platform === 'win32'
}, async () => {
  const dir = makeRepo(
    "require('fs').writeFileSync('task-started', ''); setTimeout(() => {}, 20000)"
  )

  try {
    const before = stashList(dir)
    const child = spawn(process.execPath, [wrapper], {
      cwd: dir,
      stdio: 'ignore'
    })
    const deadline = Date.now() + 15000

    while (!existsSync(path.join(dir, 'task-started'))) {
      assert.ok(Date.now() < deadline, 'the pre-commit task started')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))

    assert.equal(stashList(dir), before)
    assert.match(backupRefs(dir), /^refs\/lint-staged-backups\/[0-9a-f]{12}$/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test('a backup left over an hour ago moves off the list, a fresh one stays', () => {
  const dir = makeRepo('process.exit(0)')

  try {
    writeFileSync(path.join(dir, 'old.txt'), 'old\n')
    git(
      dir,
      ['stash', 'push', '-q', '-u', '-m', 'lint-staged automatic backup'],
      {GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'}
    )

    writeFileSync(path.join(dir, 'fresh.txt'), 'fresh\n')
    git(dir, [
      'stash',
      'push',
      '-q',
      '-u',
      '-m',
      'lint-staged automatic backup'
    ])

    writeFileSync(path.join(dir, 'a.txt'), 'a\nb\n')
    git(dir, ['add', 'a.txt'])

    runHook(dir)

    assert.equal(
      stashList(dir),
      'On main: lint-staged automatic backup\nOn main: another session'
    )

    assert.equal(backupRefs(dir).split('\n').filter(Boolean).length, 1)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
