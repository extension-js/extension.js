import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {developArtifactsMissing} from '../messages'

// A refusal worded outside the messages file misses the catalog and its review.
describe('the wording of a refused rebuild of Extension.js', () => {
  it('is written in the messages file, never beside the check', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'ensure-develop-artifacts.ts'),
      'utf8'
    )

    expect(source).not.toContain('A test run does not compile')
  })

  it('tells a test run the command, the folder and the opt-in', () => {
    const text = developArtifactsMissing(['dist/module.mjs'], {
      command: 'pnpm run compile',
      developRoot: '/repo/programs/develop',
      testRunOptIn: 'EXTENSION_COMPILE_IN_TESTS'
    })

    expect(text.split('\n').at(-1)).toBe(
      'A test run does not compile Extension.js into the checkout. Run pnpm run compile in /repo/programs/develop first, or set EXTENSION_COMPILE_IN_TESTS=1 to let the run compile.'
    )

    expect(text).not.toContain('could not rebuild')
  })
})
