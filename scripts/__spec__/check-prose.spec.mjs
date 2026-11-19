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
  'check-prose.mjs'
)

const DASH = '—'
// Built from parts so this spec does not match the pattern it tests.
const TRACKER = ['BUGS', 'TO', 'FIX'].join('_')

function checkProse(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-prose-'))

  try {
    spawnSync('git', ['init', '-q'], {cwd: dir})

    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true})
      fs.writeFileSync(path.join(dir, name), text)
    }

    return spawnSync(process.execPath, [script], {cwd: dir, encoding: 'utf8'})
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
}

test('passes a tree with plain punctuation', () => {
  const result = checkProse({'a.ts': 'const a = 1, b = 2\n'})

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /no em dashes or tracker references/)
})

test('names the file and line of an em dash in a shell script', () => {
  const result = checkProse({'tools/run.sh': `echo ok\necho a ${DASH} b\n`})

  assert.equal(result.status, 1)
  assert.match(result.stderr, /found 1 em dash/)
  assert.match(result.stderr, /tools\/run\.sh:2/)
})

test('leaves a double em dash and files of other types alone', () => {
  const result = checkProse({
    'zh.md': `text ${DASH}${DASH} text\n`,
    'notes.txt': `a ${DASH} b\n`
  })

  assert.equal(result.status, 0, result.stderr)
})

test('refuses a reference to the private tracker', () => {
  const result = checkProse({'docs/x.md': `See ${TRACKER}.md for more\n`})

  assert.equal(result.status, 1)
  assert.match(result.stderr, /found 1 private tracker reference/)
  assert.match(result.stderr, /docs\/x\.md:1/)
})
