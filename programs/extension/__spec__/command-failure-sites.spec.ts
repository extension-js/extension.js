import fs from 'node:fs'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {registerBuildCommand} from '../commands/build'
import {registerLogsCommand} from '../commands/logs'
import {registerPreviewCommand} from '../commands/preview'
import {registerPublishCommand} from '../commands/publish'
import {EMULATOR_LOGS_REFUSAL} from '../helpers/emulator-session'
import {
  makeProgram,
  runCli,
  stubCommandEnv,
  stubProcessExit
} from './command-harness'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

const extensionBuild = vi.fn(async (_path: string, _options: unknown) => {})
const extensionPreview = vi.fn(async (_path: string, _options: unknown) => {})
const loadCommandConfig = vi.fn(async () => ({}))
const runBrowser = vi.fn(async () => {})
const consumerCloses = vi.fn()
const readReadyContract = vi.fn((): unknown => null)

const loadDevelop = async () => ({extensionBuild, loadCommandConfig})
const loadPreview = async () => ({extensionPreview})

const loadBridge = async () => ({
  ...(await import('../../develop/dev-server/control-bridge/logs-query')),
  readReadyContract: () => readReadyContract(),
  BridgeConsumer: class {
    start() {}
    close() {
      consumerCloses()
    }
  }
})

let logSpy: MockInstance<typeof console.log>
let errorSpy: MockInstance<typeof console.error>
let exitSpy: MockInstance<typeof process.exit>
let written: string[]

beforeEach(() => {
  exitSpy = stubProcessExit()
  written = []
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(fs, 'writeSync').mockImplementation(((_fd: number, text: string) => {
    written.push(String(text).trim())

    return String(text).length
  }) as never)

  stubCommandEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  readReadyContract.mockReturnValue(null)
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) => {
      registerBuildCommand(program, {
        loadDevelop,
        safariPreflight: () => ({severity: 'ok', message: ''}) as never
      })

      registerPreviewCommand(program, {
        loadDevelop,
        loadPreview,
        runBrowser: runBrowser as never
      })

      registerLogsCommand(program, {loadBridge})
      registerPublishCommand(program)
    }),
    argv
  )
}

function frames(): Array<Record<string, unknown>> {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

function stderrText(): string {
  return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
}

describe('build when the engine rejects under --output json', () => {
  const diagnostics = [
    {
      code: 'E_COMPILE',
      message: "Can't resolve './missing'",
      file: 'src/background.ts',
      line: 3,
      column: 8,
      severity: 'error'
    }
  ]

  it('frames E_COMPILE with each diagnostic as a detail', async () => {
    extensionBuild.mockRejectedValueOnce(
      Object.assign(new Error('Build failed with 1 error'), {
        diagnostics,
        truncated: true
      })
    )

    expect(await run(['build', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'build',
        status: 'build-failed',
        value: null,
        error: {
          code: 'E_COMPILE',
          message: 'Build failed with 1 error',
          details: diagnostics
        },
        hint: 'Fix the error above and run build again.',
        truncated: true,
        warnings: []
      }
    ])
  })

  it('keeps a code the engine declared and leaves out empty details', async () => {
    extensionBuild.mockRejectedValueOnce(
      Object.assign(new Error('The bundler crashed'), {
        code: 'E_COMPILE_FATAL',
        diagnostics: []
      })
    )

    expect(await run(['build', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'build',
        status: 'build-failed',
        value: null,
        error: {code: 'E_COMPILE_FATAL', message: 'The bundler crashed'},
        hint: 'Fix the error above and run build again.',
        warnings: []
      }
    ])
  })

  it('stops at the first browser that fails and prints no ok frame', async () => {
    extensionBuild.mockRejectedValueOnce('a thrown string')

    expect(
      await run([
        'build',
        '.',
        '--browser',
        'chrome,firefox',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(extensionBuild).toHaveBeenCalledTimes(1)
    expect(frames()).toMatchObject([
      {ok: false, error: {code: 'E_COMPILE', message: 'a thrown string'}}
    ])
  })

  it('rethrows the engine error unframed in pretty mode', async () => {
    const failure = new Error('Build failed with 1 error')

    extensionBuild.mockRejectedValueOnce(failure)

    await expect(run(['build', '.'])).rejects.toBe(failure)
    expect(logSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

describe('preview when the launch rejects with a declared code', () => {
  it.each([
    ['E_BROWSER_NOT_FOUND', 'failed'],
    ['E_CONFIG_LOAD', 'failed'],
    ['E_REMOTE_ZIP_INVALID', 'failed'],
    ['E_BROWSER_BINARY_INVALID', 'usage']
  ])('frames %s with status %s', async (code, status) => {
    extensionPreview.mockRejectedValueOnce(
      Object.assign(new Error(`it broke with ${code}`), {code})
    )

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'preview',
        status,
        value: null,
        error: {code, message: `it broke with ${code}`},
        warnings: []
      }
    ])
  })

  it('frames a locked profile as failed, as dev and start do, naming both ways out', async () => {
    extensionPreview.mockRejectedValueOnce(
      Object.assign(new Error('The profile is in use.'), {
        code: 'E_PROFILE_LOCKED'
      })
    )

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'preview',
        status: 'failed',
        value: null,
        error: {code: 'E_PROFILE_LOCKED', message: 'The profile is in use.'},
        warnings: [],
        hint: 'Close the browser that has this profile open, or pass --profile <path> to use another one.'
      }
    ])
  })

  it('believes the declared code over the nothing-to-preview wording', async () => {
    extensionPreview.mockRejectedValueOnce(
      Object.assign(new Error('Manifest file not found'), {
        code: 'E_BROWSER_LAUNCH'
      })
    )

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toMatchObject([
      {status: 'failed', error: {code: 'E_BROWSER_LAUNCH'}}
    ])

    expect(Object.hasOwn(frames()[0], 'hint')).toBe(false)
  })

  it('rethrows the launch error unframed in pretty mode', async () => {
    const failure = Object.assign(new Error('no browser'), {
      code: 'E_BROWSER_NOT_FOUND'
    })

    extensionPreview.mockRejectedValueOnce(failure)

    await expect(run(['preview', '.'])).rejects.toBe(failure)
    expect(logSpy).not.toHaveBeenCalled()
  })
})

describe('logs on a target with nothing to attach to', () => {
  it('frames the emulator refusal as E_COMMAND_UNSUPPORTED_FOR_TARGET', async () => {
    const project = makeTempFolder('extjs-logs-emulator-')

    expect(
      await run([
        'logs',
        project,
        '--browser',
        'chromium-emulator',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(stderrText()).toBe(EMULATOR_LOGS_REFUSAL)
    expect(written.map((line) => JSON.parse(line))).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'logs',
        status: 'failed',
        value: null,
        error: {
          code: 'E_COMMAND_UNSUPPORTED_FOR_TARGET',
          message: EMULATOR_LOGS_REFUSAL,
          name: 'CliError'
        },
        warnings: []
      }
    ])
  })
})

describe('logs --follow when a signal ends it', () => {
  // The handlers are taken here and called by hand, so no signal is sent.
  function captureSignalHandlers() {
    const handlers = new Map<string, () => void>()
    const realOn = process.on.bind(process)

    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      listener: () => void
    ) => {
      if (event !== 'SIGINT' && event !== 'SIGTERM') {
        return realOn(event, listener)
      }

      handlers.set(event, listener)

      return process
    }) as never)

    return handlers
  }

  it.each([
    'SIGINT',
    'SIGTERM'
  ] as const)('closes the consumer, prints one interrupted frame and exits 0 on %s', async (signal) => {
    const project = makeTempFolder('extjs-logs-follow-')
    const handlers = captureSignalHandlers()

    // The exit is awaited by nobody here, so it must not throw.
    exitSpy.mockImplementation((() => undefined) as never)
    readReadyContract.mockReturnValue({controlPort: 1, instanceId: 'inst-1'})

    const following = run(['logs', project, '--follow', '--output', 'ndjson'])

    await vi.waitFor(() => expect(handlers.size).toBe(2))
    handlers.get(signal)?.()
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0))

    expect(consumerCloses).toHaveBeenCalledTimes(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'logs',
        status: 'interrupted',
        value: {signal, follow: true},
        error: null,
        warnings: []
      }
    ])

    // The follow itself never settles: only the exit ends it.
    expect(
      await Promise.race([
        following.then(() => 'settled'),
        new Promise((resolve) => setImmediate(() => resolve('pending')))
      ])
    ).toBe('pending')
  })

  it('prints no frame for a pretty follow and still exits 0', async () => {
    const project = makeTempFolder('extjs-logs-follow-')
    const handlers = captureSignalHandlers()

    exitSpy.mockImplementation((() => undefined) as never)
    readReadyContract.mockReturnValue({controlPort: 1, instanceId: 'inst-1'})

    void run(['logs', project, '--follow', '--output', 'pretty'])

    await vi.waitFor(() => expect(handlers.size).toBe(2))
    handlers.get('SIGINT')?.()
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0))

    expect(consumerCloses).toHaveBeenCalledTimes(1)
    expect(logSpy).not.toHaveBeenCalled()
  })
})

describe('publish when the platform misbehaves', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    const configHome = makeTempFolder('extjs-publish-fail-')

    vi.stubGlobal('fetch', fetchMock)
    // Keeps the developer's stored login and the real platform out of reach.
    vi.stubEnv('XDG_CONFIG_HOME', configHome)
    vi.stubEnv('APPDATA', configHome)
    vi.stubEnv('EXTENSION_DEV_API_URL', 'http://127.0.0.1:9')
    vi.stubEnv('EXTENSION_DEV_TOKEN', undefined)
  })

  it('waits without a bound on a request that never answers', async () => {
    const project = makeTempFolder('extjs-publish-project-')

    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"probe"}')
    fetchMock.mockReturnValue(new Promise(() => {}))

    const publishing = run(['publish', project, '--token', 'tok'])

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // Pins today's behavior: the request carries no abort signal, so no timeout.
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:9/api/cli/publish'
    )

    expect(Object.keys(fetchMock.mock.calls[0][1]).sort()).toEqual([
      'body',
      'headers',
      'method'
    ])

    expect(
      await Promise.race([
        publishing.then(() => 'settled'),
        new Promise((resolve) => setTimeout(() => resolve('pending'), 50))
      ])
    ).toBe('pending')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('lets a body that fails to read escape unframed, with no exit', async () => {
    const project = makeTempFolder('extjs-publish-project-')
    const failure = new TypeError('terminated')

    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"probe"}')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw failure
      }
    })

    // Pins today's behavior: no E_NETWORK frame, the entry files it E_INTERNAL.
    await expect(
      run(['publish', project, '--token', 'tok', '--output', 'json'])
    ).rejects.toBe(failure)

    expect(exitSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
