import {beforeEach, describe, expect, it, vi} from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('cross-spawn', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))

import {runInstall} from '../install-runner'

describe('install-runner runInstall', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => ({
      stdout: {on: () => undefined},
      stderr: {on: () => undefined},
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0))
      }
    }))
  })

  it('passes the command and args to cross-spawn with no shell option', async () => {
    // A shell would join these into one cmd.exe string, so the project path
    // must reach the package manager as a single untouched argument.
    const cwd = 'C:\\Users\\me & echo pwned\\my ext'
    const args = ['install', '--ignore-scripts']

    const result = await runInstall('pnpm.cmd', args, {cwd, stdio: 'pipe'})

    expect(result.code).toBe(0)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, spawnArgs, options] = spawnMock.mock.calls[0]
    expect(command).toBe('pnpm.cmd')
    expect(spawnArgs).toEqual(args)
    expect(options).not.toHaveProperty('shell')
    expect(options.cwd).toBe(cwd)
    expect(options.stdio).toBe('pipe')
  })
})
