import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'
import {
  findBlockNoChecks,
  isScannedSource,
  scannedFiles
} from '../check-ts-nocheck.mjs'

function blockComment(body) {
  return `/${'*'} ${body} ${'*'}/`
}

test('flags the block form at the top of a file', () => {
  const hits = findBlockNoChecks(
    `${blockComment('@ts-nocheck')}\nimport fs from 'node:fs'\n`
  )

  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 1)
  assert.equal(hits[0].text, blockComment('@ts-nocheck'))
})

test('flags the jsdoc and multiline spellings', () => {
  assert.equal(findBlockNoChecks(`/${'**'} @ts-nocheck ${'*'}/`).length, 1)

  const multiline = findBlockNoChecks(
    `const a = 1\n/${'*'}\n @ts-nocheck\n${'*'}/\nconst b = 2\n`
  )

  assert.equal(multiline.length, 1)
  assert.equal(multiline[0].line, 2)
})

test('leaves the working line form and prose alone', () => {
  assert.deepEqual(
    findBlockNoChecks('// @ts-nocheck\nconst a: number = 1\n'),
    []
  )

  assert.deepEqual(findBlockNoChecks(blockComment('@ts-ignore')), [])
  assert.deepEqual(findBlockNoChecks(blockComment('@ts-expect-error')), [])
  assert.deepEqual(findBlockNoChecks(blockComment('@ts-nocheckish')), [])
})

test('scopes the scan to source files', () => {
  assert.ok(isScannedSource('programs/develop/__spec__/setup/cleanup.ts'))
  assert.ok(isScannedSource('programs/develop/vitest.config.mts'))
  assert.ok(isScannedSource('scripts/check-ts-nocheck.mjs'))

  assert.ok(!isScannedSource('programs/develop/dist/module.mjs'))
  assert.ok(!isScannedSource('node_modules/pkg/index.js'))
  assert.ok(!isScannedSource('docs/MESSAGING.md'))
})

test('no source file carries the block form today', () => {
  const offenders = []

  for (const file of scannedFiles()) {
    const text = fs.readFileSync(file, 'utf8')

    for (const hit of findBlockNoChecks(text)) {
      offenders.push(`${file}:${hit.line}`)
    }
  }

  assert.deepEqual(offenders, [])
})
