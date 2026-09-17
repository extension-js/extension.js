import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {
  NPM_README,
  SOURCE_README,
  syncNpmReadme,
  transformReadme
} from '../sync-npm-readme.mjs'

const SAMPLE = [
  '[npm-version-image]: https://img.shields.io/npm/v/extension.svg',
  '[npm-version-url]: https://www.npmjs.com/package/extension',
  '[npm-downloads-image]: https://img.shields.io/npm/dm/extension.svg',
  '[npm-downloads-url]: https://www.npmjs.com/package/extension',
  '',
  '# Extension.js [![Version][npm-version-image]][npm-version-url] [![Downloads][npm-downloads-image]][npm-downloads-url] [![CI][action-image]][action-url]',
  '',
  '<img alt="Logo" align="right" src="logo.png" width="20.25%" />',
  ''
].join('\n')

test('the npm copy drops downloads, adds stars and shrinks the logo', () => {
  const out = transformReadme(SAMPLE)

  assert.doesNotMatch(out, /npm-downloads/)
  assert.match(
    out,
    /# Extension\.js \[!\[Version\]\[npm-version-image\]\]\[npm-version-url\] \[!\[Stars\]\[stars-image\]\]\[stars-url\] \[!\[CI\]/
  )

  assert.match(
    out,
    /^\[stars-image\]: https:\/\/img\.shields\.io\/github\/stars\//m
  )

  assert.match(out, /width="14\.1%"/)
})

test('sync writes a stale copy once and then reports it up to date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-npm-readme-'))
  const source = path.join(dir, 'README.md')
  const target = path.join(dir, 'npm-README.md')
  fs.writeFileSync(source, SAMPLE)
  fs.writeFileSync(target, 'stale\n')

  try {
    assert.equal(syncNpmReadme({source, target, write: false}).stale, true)
    assert.equal(fs.readFileSync(target, 'utf8'), 'stale\n')
    assert.equal(syncNpmReadme({source, target}).stale, true)
    assert.equal(fs.readFileSync(target, 'utf8'), transformReadme(SAMPLE))
    assert.equal(syncNpmReadme({source, target}).stale, false)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('the committed npm copy matches README.md', () => {
  const {stale} = syncNpmReadme({
    source: SOURCE_README,
    target: NPM_README,
    write: false
  })

  assert.equal(stale, false, 'run node scripts/sync-npm-readme.mjs')
})
