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
// The real scaffold copy, imported from source on purpose: createErrorCode
// substring-matches it, so a copy edit must fail here rather than silently
// downgrade a real failure to E_INTERNAL.
import * as createMessages from '../../create/lib/messages'
import {CREATE_ERROR_NEEDLES, registerCreateCommand} from '../commands/create'
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

  it('emits a schema-1 envelope with --output json', async () => {
    vi.mocked(extensionCreate).mockResolvedValueOnce({
      projectPath: '/abs/my-extension',
      projectName: 'my-extension',
      template: 'react',
      depsInstalled: false
    } as any)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(
      await run(['create', 'my-extension', '--output', 'json', '-t', 'react'])
    ).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      schema: 1,
      ok: true,
      command: 'create',
      status: 'created',
      value: {
        projectPath: '/abs/my-extension',
        projectName: 'my-extension',
        template: 'react',
        depsInstalled: false
      },
      error: null,
      warnings: []
    })
  })

  it('routes scaffold progress lines to stderr under --output json', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(extensionCreate).mockImplementationOnce(async (_p, opts: any) => {
      opts.logger.log('Creating my-extension...')
      return undefined as any
    })
    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(0)
    expect(errorSpy).toHaveBeenCalledWith('Creating my-extension...')
    // stdout carries the envelope and nothing else.
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).schema).toBe(1)
  })

  // Each row renders the CURRENT scaffold message; nothing is hardcoded, so a
  // rewrite of any of these strings breaks this test instead of the contract.
  const realMessages: Array<[string, () => Promise<string> | string]> = [
    [
      'E_DESTINATION_NOT_EMPTY',
      () => createMessages.directoryHasConflicts('/tmp/my-extension', ['a.js'])
    ],
    [
      'E_DESTINATION_NOT_WRITABLE',
      () => createMessages.destinationNotWriteable('/tmp/my-extension')
    ],
    [
      'E_TEMPLATE_NOT_FOUND',
      () => createMessages.templateNotFoundInCatalog('nope')
    ]
  ]

  it.each(
    realMessages
  )('%s: the needle is still present in the real scaffold message', async (code, render) => {
    const needle =
      CREATE_ERROR_NEEDLES[code as keyof typeof CREATE_ERROR_NEEDLES]
    expect(await render()).toContain(needle)
  })

  it.each(
    realMessages
  )('%s: a thrown real message maps to that code', async (code, render) => {
    // The scaffold rewraps the inner message, which is what reaches the CLI.
    vi.mocked(extensionCreate).mockRejectedValueOnce(
      new Error(
        createMessages.createDirectoryError(
          'my-extension',
          new Error(await render())
        )
      )
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'create',
      status: 'failed',
      value: null
    })
    expect(frame.error.code).toBe(code)
  })

  it('falls back to E_INTERNAL for an unrecognized failure', async () => {
    vi.mocked(extensionCreate).mockRejectedValueOnce(
      new Error('something else broke')
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(1)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).error.code).toBe(
      'E_INTERNAL'
    )
  })

  it('maps a TemplateNotFoundError by name', async () => {
    const error = new Error('template not found in catalog: nope')
    error.name = 'TemplateNotFoundError'
    vi.mocked(extensionCreate).mockRejectedValueOnce(error)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(1)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).error.code).toBe(
      'E_TEMPLATE_NOT_FOUND'
    )
  })

  it('rethrows without --output json so the top-level sink still owns it', async () => {
    vi.mocked(extensionCreate).mockRejectedValueOnce(new Error('boom'))
    await expect(run(['create', 'my-extension'])).rejects.toThrow('boom')
  })
})
