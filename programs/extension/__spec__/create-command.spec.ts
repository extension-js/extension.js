import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('extension-create', () => ({
  extensionCreate: vi.fn(async () => {})
}))
vi.mock('../helpers/extension-develop-runtime', () => ({
  resolveExtensionDevelopRoot: vi.fn(() => '/resolved/develop/root')
}))
vi.mock('../helpers/cli-package-json', () => ({
  getCliPackageJson: vi.fn(() => ({version: '9.9.9'}))
}))

import {extensionCreate} from 'extension-create'
import {registerCreateCommand} from '../commands/create'
import {resolveExtensionDevelopRoot} from '../helpers/extension-develop-runtime'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const savedRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT

beforeEach(() => {
  stubProcessExit()
  delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
})

afterEach(() => {
  if (savedRoot === undefined) delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
  else process.env.EXTENSION_CREATE_DEVELOP_ROOT = savedRoot
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerCreateCommand), argv)
}

describe('extension create', () => {
  it('resolves the develop root and delegates to extensionCreate', async () => {
    expect(await run(['create', 'my-extension'])).toBe(0)
    expect(process.env.EXTENSION_CREATE_DEVELOP_ROOT).toBe(
      '/resolved/develop/root'
    )
    expect(extensionCreate).toHaveBeenCalledWith('my-extension', {
      template: undefined,
      install: false,
      cliVersion: '9.9.9'
    })
  })

  it('passes --template and --install through', async () => {
    expect(
      await run(['create', 'my-extension', '--template', 'react', '--install'])
    ).toBe(0)
    expect(extensionCreate).toHaveBeenCalledWith('my-extension', {
      template: 'react',
      install: true,
      cliVersion: '9.9.9'
    })
  })

  it('respects a preset EXTENSION_CREATE_DEVELOP_ROOT', async () => {
    process.env.EXTENSION_CREATE_DEVELOP_ROOT = '/preset/root'
    expect(await run(['create', 'my-extension'])).toBe(0)
    expect(resolveExtensionDevelopRoot).not.toHaveBeenCalled()
    expect(process.env.EXTENSION_CREATE_DEVELOP_ROOT).toBe('/preset/root')
  })
})
