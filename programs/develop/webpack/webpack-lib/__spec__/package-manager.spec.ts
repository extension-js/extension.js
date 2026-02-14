import {describe, expect, it} from 'vitest'
import {buildInstallCommand} from '../package-manager'

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
