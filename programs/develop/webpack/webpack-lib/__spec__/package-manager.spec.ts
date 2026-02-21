import {describe, expect, it, vi, beforeEach} from 'vitest'

const fakeChild = {
  on: (ev: string, fn: (...a: any[]) => void) => {
    if (ev === 'close') setImmediate(() => fn(0))
    return fakeChild
  }
}
const spawnMock = vi.fn(() => fakeChild)

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawn: (...args: any[]) => spawnMock(...args),
  spawnSync: vi.fn(() => ({status: 0}))
}))

import {buildInstallCommand, execInstallCommand} from '../package-manager'

describe('package-manager buildInstallCommand', () => {
  it('executes native package manager binaries directly', () => {
    const execPath =
      process.platform === 'win32'
        ? 'C:\\tools\\pnpm\\pnpm.exe'
        : '/usr/local/bin/pnpm'
    const args = ['install', '--silent']

    const invocation = buildInstallCommand({name: 'pnpm', execPath}, args)

    expect(invocation).toEqual({
      command: execPath,
      args
    })
  })

  it('runs JS CLI entrypoints with node', () => {
    const execPath =
      process.platform === 'win32'
        ? 'C:\\node\\npm\\bin\\npm-cli.js'
        : '/tmp/npm-cli.js'
    const args = ['install', '--silent']

    const invocation = buildInstallCommand({name: 'npm', execPath}, args)

    expect(invocation).toEqual({
      command: process.execPath,
      args: [execPath, ...args]
    })
  })
})

describe('package-manager execInstallCommand', () => {
  beforeEach(() => spawnMock.mockClear())

  it('uses shell: true on Windows when command is .cmd or .bat', async () => {
    if (process.platform !== 'win32') return
    await execInstallCommand('C:\\path\\to\\pnpm.cmd', ['install'], {
      cwd: process.cwd()
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\path\\to\\pnpm.cmd',
      ['install'],
      expect.objectContaining({shell: true})
    )
  })
})
