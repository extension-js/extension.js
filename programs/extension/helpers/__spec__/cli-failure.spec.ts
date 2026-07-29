import {describe, expect, it} from 'vitest'
import {
  commanderErrorEnvelope,
  commanderExitCode,
  commanderHumanError,
  earlyExitEnvelope,
  internalErrorEnvelope,
  isCommanderError,
  isErrorFramed,
  markErrorFramed,
  wantsJsonOutput
} from '../cli-failure'

const ESC = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

function humanLines(
  err: Parameters<typeof commanderHumanError>[0],
  command: string
) {
  return commanderHumanError(err, command).replace(ANSI_PATTERN, '').split('\n')
}

describe('wantsJsonOutput', () => {
  it('detects --output json and --output=json', () => {
    expect(wantsJsonOutput(['node', 'cli', 'dev', '--output', 'json'])).toBe(
      true
    )
    expect(wantsJsonOutput(['node', 'cli', 'dev', '--output=json'])).toBe(true)
    expect(wantsJsonOutput(['node', 'cli', 'dev', '--output', 'JSON'])).toBe(
      true
    )
  })

  it('rejects pretty, ndjson, and a missing flag', () => {
    expect(wantsJsonOutput(['node', 'cli', 'dev'])).toBe(false)
    expect(wantsJsonOutput(['node', 'cli', 'dev', '--output', 'pretty'])).toBe(
      false
    )
    expect(wantsJsonOutput(['node', 'cli', 'logs', '--output', 'ndjson'])).toBe(
      false
    )
    expect(wantsJsonOutput(['node', 'cli', 'dev', '--output'])).toBe(false)
  })
})

describe('isCommanderError and commanderExitCode', () => {
  it('recognizes commander-coded errors only', () => {
    expect(isCommanderError({code: 'commander.unknownOption'})).toBe(true)
    expect(isCommanderError({code: 'E_ARGS'})).toBe(false)
    expect(isCommanderError(new Error('boom'))).toBe(false)
    expect(isCommanderError(null)).toBe(false)
  })

  it('falls back to exit 1 when exitCode is missing', () => {
    expect(commanderExitCode({code: 'commander.unknownOption'})).toBe(1)
    expect(
      commanderExitCode({code: 'commander.helpDisplayed', exitCode: 0})
    ).toBe(0)
    expect(commanderExitCode({code: 'commander.error', exitCode: 2})).toBe(2)
  })
})

describe('commanderErrorEnvelope', () => {
  it('maps an unknown option and carries the flag as a ref', () => {
    const frame = commanderErrorEnvelope(
      {
        code: 'commander.unknownOption',
        message: "error: unknown option '--nope'"
      },
      'dev'
    )
    expect(frame.schema).toBe(1)
    expect(frame.ok).toBe(false)
    expect(frame.command).toBe('dev')
    expect(frame.status).toBe('usage')
    expect(frame.error?.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(frame.error?.message).toBe("unknown option '--nope'")
    expect(frame.error?.refs).toEqual({flag: '--nope'})
  })

  it('maps an unknown command and carries the command as a ref', () => {
    const frame = commanderErrorEnvelope(
      {
        code: 'commander.unknownCommand',
        message: "error: unknown command 'capabilties'"
      },
      'capabilties'
    )
    expect(frame.error?.code).toBe('E_UNKNOWN_COMMAND')
    expect(frame.error?.refs).toEqual({command: 'capabilties'})
  })

  it('maps a missing option value onto the flag it names', () => {
    const frame = commanderErrorEnvelope(
      {
        code: 'commander.optionMissingArgument',
        message: "error: option '--output <pretty|json>' argument missing"
      },
      'build'
    )
    expect(frame.error?.code).toBe('E_FLAG_VALUE_INVALID')
    expect(frame.error?.refs).toEqual({flag: '--output'})
  })

  it('maps a missing required argument onto E_ARGS without refs', () => {
    const frame = commanderErrorEnvelope(
      {
        code: 'commander.missingArgument',
        message: "error: missing required argument 'expression'"
      },
      'eval'
    )
    expect(frame.error?.code).toBe('E_ARGS')
    expect(frame.error?.refs).toBeUndefined()
  })
})

describe('commanderHumanError', () => {
  it('renders an unknown option as a label plus a help remedy', () => {
    const lines = humanLines(
      {
        code: 'commander.unknownOption',
        message: "error: unknown option '--nope'"
      },
      'build'
    )

    expect(lines[0]).toBe('⏵⏵⏵ Unknown option --nope.')
    expect(lines[1]).toBe('Run extension build --help to see the options.')
  })

  it('restyles the closest-match suggestion as the remedy', () => {
    const lines = humanLines(
      {
        code: 'commander.unknownOption',
        message: "error: unknown option '--brower'\n(Did you mean --browser?)"
      },
      'dev'
    )

    expect(lines[0]).toBe('⏵⏵⏵ Unknown option --brower.')
    expect(lines[1]).toBe('Did you mean --browser?')
  })

  it('renders an unknown command with the root help remedy', () => {
    const lines = humanLines(
      {
        code: 'commander.unknownCommand',
        message: "error: unknown command 'nonexistent-cmd'"
      },
      'nonexistent-cmd'
    )

    expect(lines[0]).toBe('⏵⏵⏵ Unknown command nonexistent-cmd.')
    expect(lines[1]).toBe('Run extension --help to see the commands.')
  })

  it('keeps a command suggestion when commander computed one', () => {
    const lines = humanLines(
      {
        code: 'commander.unknownCommand',
        message: "error: unknown command 'buidl'\n(Did you mean build?)"
      },
      'buidl'
    )

    expect(lines[0]).toBe('⏵⏵⏵ Unknown command buidl.')
    expect(lines[1]).toBe('Did you mean build?')
  })

  it('renders a missing option value by the flag it names', () => {
    const lines = humanLines(
      {
        code: 'commander.optionMissingArgument',
        message: "error: option '--browser <browser>' argument missing"
      },
      'dev'
    )

    expect(lines[0]).toBe('⏵⏵⏵ Missing value for --browser.')
    expect(lines[1]).toBe('Run extension dev --help to see the options.')
  })

  it('falls back to the sentence-cased commander message', () => {
    const lines = humanLines(
      {
        code: 'commander.missingArgument',
        message: "error: missing required argument 'pathOrRemoteUrl'"
      },
      'create'
    )

    expect(lines[0]).toBe("⏵⏵⏵ Missing required argument 'pathOrRemoteUrl'.")
    expect(lines[1]).toBe('Run extension create --help to see the options.')
  })
})

describe('internalErrorEnvelope', () => {
  it('frames an unhandled throw as E_INTERNAL', () => {
    const frame = internalErrorEnvelope(new TypeError('boom'), 'dev')
    expect(frame.schema).toBe(1)
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('E_INTERNAL')
    expect(frame.error?.message).toBe('boom')
    expect(frame.error?.name).toBe('TypeError')
  })

  it('frames a non-error throw too', () => {
    const frame = internalErrorEnvelope('wat', 'dev')
    expect(frame.error?.message).toBe('wat')
  })
})

describe('earlyExitEnvelope', () => {
  it('carries the named flag beside the sentence', () => {
    const frame = earlyExitEnvelope(
      'build',
      'E_REMOVED_FLAG',
      '--no-runner was removed. Use --no-browser instead.',
      {flag: '--no-runner'}
    )
    expect(frame.schema).toBe(1)
    expect(frame.status).toBe('usage')
    expect(frame.error?.refs).toEqual({flag: '--no-runner'})
  })
})

describe('framed-error latch', () => {
  it('marks and detects an already-framed error', () => {
    const err = new Error('framed upstream')
    expect(isErrorFramed(err)).toBe(false)
    markErrorFramed(err)
    expect(isErrorFramed(err)).toBe(true)
  })

  it('tolerates primitives', () => {
    expect(() => markErrorFramed('nope')).not.toThrow()
    expect(isErrorFramed('nope')).toBe(false)
  })
})
