import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const packageRoot = path.join(__dirname, '..')
const require = createRequire(__filename)
const vitestBin = path.join(
  path.dirname(require.resolve('vitest/package.json')),
  'vitest.mjs'
)
const one = path.join('__spec__', 'spec-include-coverage.spec.ts')

function list(args: string[]) {
  return spawnSync(
    process.execPath,
    [vitestBin, 'list', '--filesOnly', ...args],
    {cwd: packageRoot, encoding: 'utf8', timeout: 60000}
  )
}

describe('spec paths given to vitest', () => {
  // `pnpm test -- <path>` forwards the dashes, and vitest drops every filter
  // after them, so one spec path used to start the whole suite.
  it('never turns a path after -- into the whole suite', () => {
    const result = list(['--', one])
    const listed = result.stdout
      .split('\n')
      .filter((line) => /\.spec\./.test(line))

    if (result.status === 0) {
      expect(listed).toEqual([one.split(path.sep).join('/')])
    } else {
      expect(listed).toEqual([])
      expect(result.stderr).toContain('without the --')
    }
  })

  it('runs a path given without the dashes', () => {
    const result = list([one])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(one.split(path.sep).join('/'))
  })
})
