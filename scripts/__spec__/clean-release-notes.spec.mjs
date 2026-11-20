import assert from 'node:assert/strict'
import test from 'node:test'
import {cleanBody} from '../clean-release-notes.mjs'

test('drops the release bookkeeping lines and keeps every change', () => {
  const body = [
    '## Changes',
    '',
    '- Fix the Firefox reload (#12)',
    '- chore(release): 4.1.0',
    '- release(stable): v4.1.0',
    '- Release stable v4.1.0',
    '- Move the changelog to v4.1.0',
    '',
    '',
    '',
    '- Add a flag (#13)'
  ].join('\n')

  assert.equal(
    cleanBody(body),
    '## Changes\n\n- Fix the Firefox reload (#12)\n\n- Add a flag (#13)'
  )
})

test('keeps a change whose title only mentions a release', () => {
  const body = '- Release notes link the right tag (#20)\n'

  assert.equal(cleanBody(body), '- Release notes link the right tag (#20)')
})

test('passes an empty or missing body through', () => {
  assert.equal(cleanBody(''), '')
  assert.equal(cleanBody(null), null)
})
