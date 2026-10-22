import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {HOOKS_PATH, installGitHooks} from '../install-git-hooks.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

const isolatedEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'spec',
  GIT_AUTHOR_EMAIL: 'spec@example.com',
  GIT_COMMITTER_NAME: 'spec',
  GIT_COMMITTER_EMAIL: 'spec@example.com',
  HUSKY: ''
}

function git(args, cwd, env = isolatedEnv) {
  return spawnSync('git', args, {cwd, env, encoding: 'utf8'})
}

function writeExecutable(file, contents) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
  fs.chmodSync(file, 0o755)
}

function addFakeLinter(top) {
  writeExecutable(
    path.join(top, 'node_modules/.bin/fake-lint'),
    '#!/usr/bin/env sh\nif git diff --cached | grep -q LINT_ERROR; then\n  echo "fake-lint: LINT_ERROR staged" >&2\n  exit 1\nfi\n'
  )
}

function makeRepoWithHooks() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-spec-'))
  const main = path.join(base, 'main')

  fs.mkdirSync(main)
  assert.equal(git(['init', '-q', '-b', 'main'], main).status, 0)

  for (const file of fs.readdirSync(path.join(repoRoot, HOOKS_PATH))) {
    fs.mkdirSync(path.join(main, HOOKS_PATH), {recursive: true})
    fs.copyFileSync(
      path.join(repoRoot, HOOKS_PATH, file),
      path.join(main, HOOKS_PATH, file)
    )

    fs.chmodSync(path.join(main, HOOKS_PATH, file), 0o755)
  }

  writeExecutable(path.join(main, '.husky/pre-commit'), 'fake-lint\n')
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules\n')
  fs.writeFileSync(path.join(main, 'README.md'), 'start\n')

  assert.equal(git(['add', '-A'], main).status, 0)
  assert.equal(
    git(['commit', '-q', '-m', 'start'], main, {...isolatedEnv, HUSKY: '0'})
      .status,
    0
  )

  const result = installGitHooks({env: isolatedEnv, cwd: main})
  assert.deepEqual(result, {installed: true})

  return {base, main}
}

function addWorktree(main, base, name) {
  const worktree = path.join(base, name)

  assert.equal(git(['worktree', 'add', '-q', worktree], main).status, 0)

  return worktree
}

function stageAndCommit(cwd, file, contents, env = isolatedEnv) {
  fs.writeFileSync(path.join(cwd, file), contents)
  assert.equal(git(['add', file], cwd).status, 0)

  return git(['commit', '-q', '-m', `add ${file}`], cwd, env)
}

const runsShellHooks = process.platform !== 'win32'

test('the installer points core.hooksPath at the tracked hooks folder', () => {
  const {main} = makeRepoWithHooks()

  assert.equal(
    git(['config', 'core.hooksPath'], main).stdout.trim(),
    HOOKS_PATH
  )
})

test('the installer does nothing when HUSKY=0 or outside a work tree', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-none-'))

  assert.deepEqual(installGitHooks({env: {HUSKY: '0'}, cwd: outside}), {
    installed: false,
    reason: 'disabled'
  })

  assert.deepEqual(
    installGitHooks({
      env: {...isolatedEnv, GIT_CEILING_DIRECTORIES: outside},
      cwd: outside
    }),
    {installed: false, reason: 'not-a-work-tree'}
  )
})

test('a fresh worktree refuses a commit the linter rejects', {
  skip: !runsShellHooks
}, () => {
  const {base, main} = makeRepoWithHooks()
  const worktree = addWorktree(main, base, 'fresh')

  addFakeLinter(worktree)

  const refused = stageAndCommit(worktree, 'bad.txt', 'LINT_ERROR\n')
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /fake-lint: LINT_ERROR staged/)
  assert.equal(
    git(['log', '--oneline'], worktree).stdout.trim().split('\n').length,
    1
  )

  assert.equal(git(['reset', '-q'], worktree).status, 0)
  fs.rmSync(path.join(worktree, 'bad.txt'))

  const accepted = stageAndCommit(worktree, 'good.txt', 'fine\n')
  assert.equal(accepted.status, 0, accepted.stderr)
})

test('a fresh worktree with no install refuses the commit and names the fix', {
  skip: !runsShellHooks
}, () => {
  const {base, main} = makeRepoWithHooks()
  const worktree = addWorktree(main, base, 'bare')

  const refused = stageAndCommit(worktree, 'file.txt', 'fine\n')
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /run pnpm install in .* first, or set HUSKY=0/)
})

test('HUSKY=0 skips the hook in a worktree', {skip: !runsShellHooks}, () => {
  const {base, main} = makeRepoWithHooks()
  const worktree = addWorktree(main, base, 'skip')

  const accepted = stageAndCommit(worktree, 'bad.txt', 'LINT_ERROR\n', {
    ...isolatedEnv,
    HUSKY: '0'
  })
  assert.equal(accepted.status, 0, accepted.stderr)
})

test('every hook body has an executable tracked stub', () => {
  const hooks = fs
    .readdirSync(path.join(repoRoot, '.husky'), {withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)

  const staged = git(['ls-files', '-s', '--', HOOKS_PATH], repoRoot).stdout

  for (const name of ['h', ...hooks]) {
    assert.match(
      staged,
      new RegExp(`^100755 \\S+ \\d\\t${HOOKS_PATH}/${name}$`, 'm'),
      `${HOOKS_PATH}/${name} should be tracked as executable`
    )
  }
})

test('prepare installs the tracked hooks instead of a generated folder', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
  )

  assert.equal(pkg.scripts.prepare, 'node scripts/install-git-hooks.mjs')
  assert.equal(pkg.devDependencies?.husky, undefined)
})
