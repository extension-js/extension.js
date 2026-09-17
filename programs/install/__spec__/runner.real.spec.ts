import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {browserInstallCommand, runCommand} from '../lib/runner'

// Nothing is mocked here on purpose: the sibling spec mocks cross-spawn, so
// only a real spawn proves the .cmd shims resolve on the Windows lane.
const VERSION = /^\d+\.\d+\.\d+/

function onPath(name: string): boolean {
  const bare = name.replace(/\.(cmd|exe|bat)$/i, '')
  const suffixes =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  const dirs = (process.env.PATH || '').split(path.delimiter)

  return dirs.some(
    (dir) =>
      dir &&
      suffixes.some((suffix) => fs.existsSync(path.join(dir, bare + suffix)))
  )
}

describe('install runner runCommand (real spawn)', () => {
  it('runs npx --version through its .cmd shim with no shell', async () => {
    // npx ignores the trailing argument. A shell would run "b" after "&"
    // and turn the exit code non-zero, so a zero exit proves no shell ran.
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const result = await runCommand(command, ['--version', 'a & b'], {
      cwd: process.cwd(),
      env: {...process.env}
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(VERSION)
    expect(result.stderr).not.toMatch(/not recognized|not found/i)
  })

  it.skipIf(!onPath('pnpm'))(
    'runs pnpm --version through its .cmd shim',
    async () => {
      const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
      const result = await runCommand(command, ['--version'], {
        cwd: process.cwd(),
        env: {...process.env}
      })

      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toMatch(VERSION)
    }
  )

  it('runs the runner the install command picks for this process', async () => {
    // Under pnpm this is pnpm.cmd, otherwise npx.cmd: the same resolution
    // the browser install uses, with a harmless argument in place of dlx.
    const command = browserInstallCommand('chrome')
    const result = await runCommand(command, ['--version'], {
      cwd: process.cwd(),
      env: {...process.env}
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(VERSION)
  })
})
