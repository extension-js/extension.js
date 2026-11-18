import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {test} from 'node:test'

// Requiring the wrapper loads its helpers without formatting anything: the
// formatter only runs when the file is the entry point.
const {exitCodeFor} = createRequire(import.meta.url)('../format-wrapper.cjs')

function quietly(fn) {
  const original = console.error
  const lines = []
  console.error = (line) => lines.push(line)

  try {
    return {code: fn(), lines}
  } finally {
    console.error = original
  }
}

test('a formatter that could not spawn fails and says why', () => {
  const {code, lines} = quietly(() =>
    exitCodeFor(
      {status: null, signal: null, error: new Error('spawn EACCES')},
      'Biome'
    )
  )

  assert.equal(code, 1)
  assert.match(lines.join('\n'), /Biome could not run \(spawn EACCES\)/)
})

test('a formatter that exited keeps its exit code', () => {
  assert.equal(exitCodeFor({status: 0, signal: null}, 'Biome'), 0)
  assert.equal(exitCodeFor({status: 3, signal: null}, 'eslint'), 3)
})

test('a formatter killed by a signal fails', () => {
  assert.equal(exitCodeFor({status: null, signal: 'SIGTERM'}, 'Biome'), 1)
})
