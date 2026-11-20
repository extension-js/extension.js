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

// Recorded rather than sent: a spec reads what a failure row would say.
vi.mock('../helpers/telemetry-cli', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/telemetry-cli')>()),
  markCommandFailure: vi.fn()
}))

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {PassThrough} from 'node:stream'
import {extensionCreate} from 'extension-create'
// The real scaffold steps, imported from source on purpose: the code a
// failure answers is the one the step puts on the error it throws.
import {readTemplatePackageJson} from '../../create/lib/find-manifest-json'
import {runCreate} from '../../create/run-create'
import {createDirectory} from '../../create/steps/create-directory'
import {TemplateNotFoundError} from '../../create/steps/import-external-template'
import {installDependencies} from '../../create/steps/install-dependencies'
import {setupBuiltInTests} from '../../create/steps/setup-built-in-tests'
import {writeManifestJson} from '../../create/steps/write-manifest-json'
import {registerCreateCommand} from '../commands/create'
import {resolveExtensionDevelopRoot} from '../helpers/extension-develop-runtime'
import {markCommandFailure} from '../helpers/telemetry-cli'
import {
  keepTheScaffolderMocked,
  makeProgram,
  runCli,
  stubProcessExit
} from './command-harness'

type CreateResult = Awaited<ReturnType<typeof extensionCreate>>

const savedRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT
const quiet = {log: () => {}, error: () => {}}

keepTheScaffolderMocked(registerCreateCommand, extensionCreate)

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

  // The run happens inside vitest, with VITEST set, so this also proves the
  // prompt is decided by the terminal it is handed and by nothing else.
  it('asks a person at a terminal for the name and creates what they typed', async () => {
    const input = Object.assign(new PassThrough(), {isTTY: true})
    const output = Object.assign(new PassThrough(), {isTTY: true})
    const program = makeProgram((cli) =>
      registerCreateCommand(cli, {
        promptIo: {input, output, env: {VITEST: 'true'}}
      })
    )

    output.once('data', () => input.write('tab-notes\n'))

    expect(await runCli(program, ['create'])).toBe(0)
    expect(extensionCreate).toHaveBeenCalledWith('tab-notes', {
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
      packageName: 'my-extension',
      template: 'react',
      depsInstalled: false
    } as CreateResult)

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
        packageName: 'my-extension',
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
    vi.mocked(extensionCreate).mockImplementationOnce(async (_p, opts) => {
      if (!opts.logger) throw new Error('the command passed no logger')

      opts.logger.log('Creating my-extension...')

      return undefined as unknown as CreateResult
    })

    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(0)
    expect(errorSpy).toHaveBeenCalledWith('Creating my-extension...')
    // stdout carries the envelope and nothing else.
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).schema).toBe(1)
  })

  // Each row is a real create step failing on a real folder, so the error the
  // CLI reads is the one the scaffold throws, code and all.
  const realFailures: Array<
    [string, string, (dir: string) => Promise<unknown>]
  > = [
    [
      'a destination that holds files',
      'E_DESTINATION_NOT_EMPTY',
      async (dir) => {
        fs.writeFileSync(path.join(dir, 'a.js'), '')

        return createDirectory(dir, 'my-extension', quiet)
      }
    ],
    [
      'a destination that is a file',
      'E_DESTINATION_NOT_WRITABLE',
      async (dir) => {
        const file = path.join(dir, 'file')
        fs.writeFileSync(file, '')

        return createDirectory(file, 'file', quiet)
      }
    ],
    [
      'built-in tests that cannot be set up',
      'E_DESTINATION_NOT_WRITABLE',
      async (dir) => {
        fs.mkdirSync(path.join(dir, 'tests', 'templates.spec.ts'), {
          recursive: true
        })

        return setupBuiltInTests(dir)
      }
    ],
    [
      'a template with no manifest.json',
      'E_TEMPLATE_NOT_FOUND',
      async (dir) => writeManifestJson(dir, quiet)
    ],
    [
      "a template package.json that doesn't parse",
      'E_TEMPLATE_NOT_FOUND',
      async (dir) => {
        fs.writeFileSync(path.join(dir, 'package.json'), '{')

        return readTemplatePackageJson(dir)
      }
    ],
    [
      // The install output quotes another step's wording, which a reader
      // that matched text in order used to answer with that step's code.
      "an install whose output says Couldn't write",
      'E_DEPENDENCY_INSTALL',
      async (dir) => {
        fs.writeFileSync(
          path.join(dir, 'package.json'),
          JSON.stringify({devDependencies: {extension: '4.0.0'}})
        )

        return installDependencies(
          dir,
          'my-extension',
          quiet,
          'npm',
          undefined,
          async () => ({
            code: 1,
            stdout: '',
            stderr: "npm error Couldn't write the cache folder\n"
          })
        )
      }
    ],
    [
      'a URL given as the project name',
      'E_INVALID_OPTION',
      async () => runCreate('https://example.com/my-extension', {})
    ],
    ['no project name', 'E_ARGS', async () => runCreate(undefined, {})]
  ]

  it.each(
    realFailures
  )('%s answers %s in --output json', async (_name, code, fail) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-code-'))

    try {
      const thrown = await fail(dir).then(
        () => new Error('the step did not fail'),
        (error: unknown) => error
      )

      vi.mocked(extensionCreate).mockRejectedValueOnce(thrown)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(1)
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))

      expect(frame).toMatchObject({
        schema: 1,
        ok: false,
        command: 'create',
        status: 'failed',
        value: null,
        error: {code}
      })
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  // Only a catalog code counts. Wording, an errno and a made-up code are not.
  it.each([
    ['no code', new Error("Couldn't install the dependencies for x.")],
    ['an errno code', Object.assign(new Error('EACCES'), {code: 'EACCES'})],
    [
      'a code outside the catalog',
      Object.assign(new Error('x'), {code: 'E_NOPE'})
    ]
  ])('answers E_INTERNAL for a failure with %s', async (_name, thrown) => {
    vi.mocked(extensionCreate).mockRejectedValueOnce(thrown)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(1)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).error.code).toBe(
      'E_INTERNAL'
    )
  })

  it('tells telemetry an unrecognized failure came from the scaffolder', async () => {
    const thrown = new TypeError('something else broke')
    vi.mocked(extensionCreate).mockRejectedValueOnce(thrown)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(await run(['create', 'my-extension', '--output', 'json'])).toBe(1)
    expect(markCommandFailure).toHaveBeenCalledWith(undefined, {
      code: 'E_INTERNAL',
      exitCode: 1,
      error: thrown,
      step: 'scaffold'
    })
  })

  it('reads the code a typed template error carries', async () => {
    vi.mocked(extensionCreate).mockRejectedValueOnce(
      new TemplateNotFoundError('nope')
    )

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
