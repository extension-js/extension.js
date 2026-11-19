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
import {
  bridgeStandIn,
  developStandIn,
  previewStandIn
} from './helpers/engine-stand-ins'

const makeTempFolder = trackTempFolders()

const extensionBuild = vi.fn(async (_path: string, _options: unknown) => {})
const extensionPreview = vi.fn(async (_path: string, _options: unknown) => {})
const loadCommandConfig = vi.fn(async () => ({}))
const runBrowser = vi.fn(async () => {})
const consumerCloses = vi.fn()
const readReadyContract = vi.fn((): unknown => null)
// The one call that sends a build failure row, so a spec reads what travels.
const reportBuildFailure = vi.fn()

const loadDevelop = async () =>
  developStandIn({extensionBuild, loadCommandConfig})
const loadPreview = async () => previewStandIn({extensionPreview})

const loadBridge = async () =>
  bridgeStandIn({
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
        safariPreflight: () => ({severity: 'ok', message: ''}) as never,
        reportFailure: reportBuildFailure
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

describe('build when the engine rejects', () => {
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

  // The engine printed the failure before it rejected, so the command adds
  // no line of its own and ends the run with the code the error declared.
  it('exits 1 unframed in pretty mode, with the declared code reported', async () => {
    extensionBuild.mockRejectedValueOnce(
      Object.assign(new Error('The bundler crashed'), {
        code: 'E_COMPILE_FATAL'
      })
    )

    expect(await run(['build', '.'])).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(exitSpy.mock.calls).toEqual([[1]])
    expect(reportBuildFailure.mock.calls).toEqual([
      [{code: 'E_COMPILE_FATAL', exitCode: 1}]
    ])
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

  it('gives up on a request that never answers after 30 s, with E_NETWORK', async () => {
    const project = makeTempFolder('extjs-publish-project-')

    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"probe"}')
    // Answers nothing, and rejects the way fetch does once its signal aborts.
    fetchMock.mockImplementation(
      (_url: string, init: {signal: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))
          )
        })
    )

    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    try {
      const publishing = run([
        'publish',
        project,
        '--token',
        'tok',
        '--output',
        'json'
      ])

      // setImmediate is not faked, so this waits for the request without
      // moving the clock the bound is read on.
      for (let turn = 0; turn < 100 && !fetchMock.mock.calls.length; turn++) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://127.0.0.1:9/api/cli/publish'
      )

      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal

      await vi.advanceTimersByTimeAsync(29_999)
      expect(signal.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(5000)

      expect(await publishing).toBe(1)
    } finally {
      vi.useRealTimers()
    }

    expect(frames()).toMatchObject([
      {
        ok: false,
        command: 'publish',
        status: 'failed',
        error: {
          code: 'E_NETWORK',
          message:
            'http://127.0.0.1:9/api/cli/publish did not answer within 30 s.'
        }
      }
    ])
  })

  it('frames a body that fails to read as E_NETWORK', async () => {
    const project = makeTempFolder('extjs-publish-project-')

    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"probe"}')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError('terminated')
      }
    })

    expect(
      await run(['publish', project, '--token', 'tok', '--output', 'json'])
    ).toBe(1)

    expect(frames()).toMatchObject([
      {
        ok: false,
        status: 'failed',
        error: {
          code: 'E_NETWORK',
          message:
            'Could not reach http://127.0.0.1:9/api/cli/publish: terminated'
        }
      }
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
