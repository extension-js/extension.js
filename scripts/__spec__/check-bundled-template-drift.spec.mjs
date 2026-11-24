import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-bundled-template-drift.sh'
)

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'spec',
  GIT_AUTHOR_EMAIL: 'spec@example.com',
  GIT_COMMITTER_NAME: 'spec',
  GIT_COMMITTER_EMAIL: 'spec@example.com'
}

function git(args, cwd) {
  const result = spawnSync('git', args, {cwd, env: gitEnv, encoding: 'utf8'})
  assert.equal(result.status, 0, result.stderr)

  return result.stdout.trim()
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)
}

// A local templates repository and a copy of the script in a tree shaped
// like this one, so the check never reaches the network.
function makeTrees(bundledManifest) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'template-drift-'))
  const templates = path.join(base, 'templates')
  const repo = path.join(base, 'repo')

  write(path.join(templates, 'examples/javascript/manifest.json'), '{"a":1}\n')
  write(path.join(templates, 'examples/javascript/template.spec.ts'), 'x\n')
  git(['init', '-q', '-b', 'main'], templates)
  git(['add', '-A'], templates)
  git(['commit', '-q', '-m', 'start'], templates)
  const pin = git(['rev-parse', 'HEAD'], templates)

  fs.mkdirSync(path.join(repo, 'scripts'), {recursive: true})
  fs.copyFileSync(script, path.join(repo, 'scripts', path.basename(script)))
  write(
    path.join(repo, 'programs/create/steps/import-external-template.ts'),
    `export const DEFAULT_TEMPLATES_REF = '${pin}'\n`
  )

  write(
    path.join(repo, 'programs/create/templates/javascript/manifest.json'),
    bundledManifest
  )

  return {base, templates, repo}
}

function runCheck({templates, repo}, args = []) {
  return spawnSync(
    'bash',
    [path.join(repo, 'scripts', path.basename(script)), ...args],
    {
      encoding: 'utf8',
      env: {...gitEnv, TEMPLATES_REPO_URL: templates}
    }
  )
}

const runsBash = process.platform !== 'win32'

test('passes when the bundled copy matches the pinned templates', {
  skip: !runsBash
}, () => {
  const trees = makeTrees('{"a":1}\n')

  try {
    const result = runCheck(trees)

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /is in sync/)
  } finally {
    fs.rmSync(trees.base, {recursive: true, force: true})
  }
})

test('fails on drift and prints the resync command', {skip: !runsBash}, () => {
  const trees = makeTrees('{"a":2}\n')

  try {
    const result = runCheck(trees)

    assert.equal(result.status, 1)
    assert.match(result.stdout, /-\{"a":2\}/)
    assert.match(result.stderr, /has drifted from/)
    assert.match(result.stderr, /rsync -a --delete/)
    assert.match(result.stderr, /check-bundled-template-drift\.sh --write/)
  } finally {
    fs.rmSync(trees.base, {recursive: true, force: true})
  }
})

test('--write brings the bundled copy to the pinned templates', {
  skip: !runsBash
}, () => {
  const trees = makeTrees('{"a":2}\n')
  const bundled = path.join(trees.repo, 'programs/create/templates/javascript')

  try {
    write(path.join(bundled, 'gone-upstream.js'), 'x\n')

    const written = runCheck(trees, ['--write'])

    assert.equal(written.status, 0, written.stderr)
    assert.match(written.stdout, /Resynced the bundled javascript template/)
    assert.deepEqual(fs.readdirSync(bundled), ['manifest.json'])
    assert.equal(
      fs.readFileSync(path.join(bundled, 'manifest.json'), 'utf8'),
      '{"a":1}\n'
    )

    assert.equal(runCheck(trees).status, 0)
  } finally {
    fs.rmSync(trees.base, {recursive: true, force: true})
  }
})

test('notes a pin that is behind templates main', {skip: !runsBash}, () => {
  const trees = makeTrees('{"a":1}\n')

  try {
    write(path.join(trees.templates, 'README.md'), 'later\n')
    git(['add', '-A'], trees.templates)
    git(['commit', '-q', '-m', 'later'], trees.templates)

    const result = runCheck(trees)

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /1 commit\(s\) behind examples main/)
  } finally {
    fs.rmSync(trees.base, {recursive: true, force: true})
  }
})

test('the release commit can stage the bundled template', () => {
  const root = path.resolve(path.dirname(script), '..')
  const ignored = (file) =>
    spawnSync('git', ['check-ignore', '-q', '--no-index', file], {
      cwd: root,
      env: gitEnv
    }).status
  // The publish job runs git add -A on this folder, which refuses an ignored path.
  assert.equal(ignored('programs/create/templates/javascript/package.json'), 1)
  assert.equal(ignored('templates/javascript/package.json'), 0)
})
