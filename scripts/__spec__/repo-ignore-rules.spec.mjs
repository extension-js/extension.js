import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

function tracked(pattern) {
  return execFileSync('git', ['ls-files', '--', pattern], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
}

// A re-include rule exists to keep tracked files out of a wider ignore, so one
// that matches no tracked file names a path that is gone.
test('every re-include rule in the root .gitignore keeps a tracked file', () => {
  const rules = fs
    .readFileSync(path.join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('!'))

  assert.ok(rules.length > 0)

  for (const rule of rules) {
    assert.notEqual(tracked(rule.slice(1)), '', rule)
  }
})

// The optional-deps smoke reads a consumer fixture from this folder when one
// exists locally, so it must never show up as a file to commit.
test('the local optional-deps fixture folder stays ignored', () => {
  const ignored = execFileSync(
    'git',
    ['check-ignore', 'extensions/browser-extension/package.json'],
    {cwd: root, encoding: 'utf8'}
  ).trim()

  assert.equal(ignored, 'extensions/browser-extension/package.json')
})
