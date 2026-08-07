import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  readPinnedRef,
  renderCorpusModule,
  writePinnedRef
} from '../generate-template-corpus.mjs'

const PINNED = "export const DEFAULT_TEMPLATES_REF = '" + 'a'.repeat(40) + "'"

test('reads the pin the scaffolder declares', () => {
  const source = ['// preamble', PINNED, 'const other = 1'].join('\n')
  assert.equal(readPinnedRef(source), 'a'.repeat(40))
})

test('refuses a file that declares no pin', () => {
  assert.throws(() => readPinnedRef('const nothing = true'))
})

test('moves the pin and leaves the rest of the file alone', () => {
  const source = ['// preamble', PINNED, 'const other = 1'].join('\n')
  const moved = writePinnedRef(source, 'b'.repeat(40))
  assert.equal(readPinnedRef(moved), 'b'.repeat(40))
  assert.ok(moved.includes('const other = 1'))
  assert.ok(moved.includes('// preamble'))
})

test('refuses to move a pin the file does not declare', () => {
  assert.throws(() => writePinnedRef('const nothing = true', 'c'.repeat(40)))
})

test('renders the ref and every slug it was given', () => {
  const rendered = renderCorpusModule({
    repo: 'extension-js/examples',
    ref: 'd'.repeat(40),
    slugs: ['action', 'init', 'javascript']
  })
  assert.ok(rendered.includes(`TEMPLATE_CORPUS_REF = '${'d'.repeat(40)}'`))
  for (const slug of ['action', 'init', 'javascript']) {
    assert.ok(rendered.includes(`'${slug}'`), slug)
  }
  assert.ok(rendered.includes('Do not edit by hand'))
})
