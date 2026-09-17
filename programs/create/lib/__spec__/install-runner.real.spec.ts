import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {runInstall} from '../install-runner'

// Nothing is mocked here on purpose: the sibling spec mocks cross-spawn, so
// only a real spawn proves the .cmd shims resolve on the Windows lane.
const VERSION = /^\d+\.\d+\.\d+/

function onPath(name: string): boolean {
  const suffixes =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  const dirs = (process.env.PATH || '').split(path.delimiter)

  return dirs.some(
    (dir) =>
      dir &&
      suffixes.some((suffix) => fs.existsSync(path.join(dir, name + suffix)))
  )
}

describe('install-runner runInstall (real spawn)', () => {
  it('runs npm --version through its .cmd shim with no shell', async () => {
    // npm ignores the trailing argument. A shell would run "b" after "&"
    // and turn the exit code non-zero, so a zero exit proves no shell ran.
    const result = await runInstall('npm', ['--version', 'a & b'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(VERSION)
    expect(result.stderr).not.toMatch(/not recognized|not found/i)
  })

  it.skipIf(!onPath('pnpm'))(
    'runs pnpm --version through its .cmd shim',
    async () => {
      const result = await runInstall('pnpm', ['--version'], {
        cwd: process.cwd(),
        stdio: 'pipe'
      })

      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toMatch(VERSION)
    }
  )
})
