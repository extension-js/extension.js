import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const bridge = {
  result: {ok: true, value: 'v'} as Record<string, unknown>
}

const marks = vi.hoisted(() => ({
  failures: [] as Array<Record<string, unknown>>
}))

vi.mock('../helpers/telemetry-cli', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../helpers/telemetry-cli')>()

  return {
    ...actual,
    markCommandFailure: (_command: unknown, details: Record<string, unknown>) =>
      marks.failures.push(details)
  }
})

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: () => ({controlPort: 9123, instanceId: 'inst-1'}),
    readReadyContractDocument: () => null,
    readControlToken: () => 'tok-1',
    BridgeController: class {
      async connect() {}
      async command() {
        return bridge.result
      }
      close() {}
    }
  }))
}))

import {registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let errorSpy: MockInstance<typeof console.error>

function printedErrors(): string {
  return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
}

beforeEach(() => {
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  marks.failures.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a failed eval names its cause in telemetry', () => {
  it('marks the guest throw as E_EVAL before exiting', async () => {
    bridge.result = {ok: false, error: {name: 'EvalError', message: 'boom'}}

    expect(
      await runCli(makeProgram(registerActCommands), ['eval', 'boom()'])
    ).toBe(1)

    expect(marks.failures).toEqual([{code: 'E_EVAL', exitCode: 1}])
  })

  it('marks a refused eval with the refusal code', async () => {
    bridge.result = {
      ok: false,
      error: {name: 'EvalDisabled', message: 'eval is off'}
    }

    expect(await runCli(makeProgram(registerActCommands), ['eval', '1'])).toBe(
      1
    )

    expect(marks.failures).toEqual([{code: 'E_EVAL_REFUSED', exitCode: 1}])
  })

  it('marks nothing when the eval succeeds', async () => {
    bridge.result = {ok: true, value: 2}

    expect(
      await runCli(makeProgram(registerActCommands), ['eval', '1+1'])
    ).toBe(0)

    expect(marks.failures).toEqual([])
  })
})

describe('a failed act verb prints its hint on the human channel', () => {
  it('prints the CSP hint under a refused eval', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'EvalError',
        message:
          "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed"
      }
    }

    expect(await runCli(makeProgram(registerActCommands), ['eval', '1'])).toBe(
      1
    )

    expect(printedErrors()).toContain('EvalError: Refused to evaluate')
    expect(printedErrors()).toContain('extension inspect --context')
  })

  it('prints a hint the bridge supplied for any verb', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'StorageError',
        message: 'quota exceeded',
        hint: 'Clear the area with extension storage clear first.'
      }
    }

    expect(
      await runCli(makeProgram(registerActCommands), [
        'storage',
        'get',
        '--area',
        'local'
      ])
    ).toBe(1)

    expect(printedErrors()).toContain(
      'Clear the area with extension storage clear first.'
    )
  })
})
