import {describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'

type ErrorFrame = {
  schema: number
  ok: boolean
  command: string
  status: string
  error: {
    code: string
    message: string
    name: string
    refs?: Record<string, string>
  }
}

async function failed(args: string[]) {
  const result = await runCli(args)
  const frames = everyLineAsFrame<ErrorFrame>(result.stdout)

  expect(frames, result.output).toHaveLength(1)

  return {result, frame: frames[0]}
}

describe('pre-command failures under --output json', () => {
  it('frames an unknown command as one schema-1 envelope on stdout', async () => {
    const {result, frame} = await failed([
      'nonexistent-cmd',
      '--output',
      'json'
    ])

    expect(result.status).toBe(1)
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'nonexistent-cmd',
      status: 'usage'
    })

    expect(frame.error.code).toBe('E_UNKNOWN_COMMAND')
    expect(frame.error.refs).toEqual({command: 'nonexistent-cmd'})
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Unknown command nonexistent-cmd.\n' +
        'Run extension --help to see the commands.\n'
    )
  })

  it('frames an unknown option with the flag carried as a ref', async () => {
    const {result, frame} = await failed(['dev', '--nope', '--output', 'json'])

    expect(result.status).toBe(1)
    expect(frame).toMatchObject({command: 'dev', status: 'usage'})
    expect(frame.error.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(frame.error.refs).toEqual({flag: '--nope'})
    expect(result.stderr).toContain('Unknown option --nope.')
  })

  it('frames a missing required argument', async () => {
    const {result, frame} = await failed(['eval', '--output', 'json'])

    expect(result.status).toBe(1)
    expect(frame).toMatchObject({command: 'eval', status: 'usage'})
    expect(frame.error.code).toBe('E_ARGS')
    expect(result.stderr).toBe(
      "⏵⏵⏵ Error: Missing required argument 'expression'.\n" +
        'Run extension eval --help to see the options.\n'
    )
  })

  it('frames an option left without its value as E_FLAG_VALUE_INVALID', async () => {
    const {result, frame} = await failed([
      'build',
      '--output',
      'json',
      '--browser'
    ])

    expect(result.status).toBe(1)
    expect(frame).toMatchObject({command: 'build', status: 'usage'})
    expect(frame.error.code).toBe('E_FLAG_VALUE_INVALID')
    expect(frame.error.refs).toEqual({flag: '--browser'})
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Missing value for --browser.\n' +
        'Run extension build --help to see the options.\n'
    )
  })

  it('frames a value a command refuses by itself as E_FLAG_VALUE_INVALID', async () => {
    const {result, frame} = await failed([
      'logs',
      '.',
      '--tab',
      'abc',
      '--output',
      'json'
    ])

    expect(result.status).toBe(1)
    expect(frame).toMatchObject({command: 'logs', status: 'usage'})
    expect(frame.error.code).toBe('E_FLAG_VALUE_INVALID')
    expect(frame.error.message).toBe(
      '--tab expects a positive integer, got: abc'
    )

    expect(result.stderr).toBe('--tab expects a positive integer, got: abc\n')
  })

  it('frames a pre-parse removed-flag refusal', async () => {
    const {result, frame} = await failed([
      'build',
      '--no-runner',
      '--output',
      'json'
    ])

    expect(result.status).toBe(1)
    expect(frame.error.code).toBe('E_REMOVED_FLAG')
    expect(frame.error.refs).toEqual({flag: '--no-runner'})
    expect(frame.error.message).toBe(
      '--no-runner was removed. Use --no-browser instead.'
    )
  })

  // The frame carries the copy stderr prints and its remedy as the hint.
  it.each([
    [
      ['nonexistent-cmd', '--output', 'json'],
      'Unknown command nonexistent-cmd.',
      'Run extension --help to see the commands.'
    ],
    [
      ['dev', '--nope', '--output', 'json'],
      'Unknown option --nope.',
      'Did you mean --no-open?'
    ],
    [
      ['eval', '--output', 'json'],
      "Missing required argument 'expression'.",
      'Run extension eval --help to see the options.'
    ]
  ])('%j carries the stderr copy as error.message', async (args, message, hint) => {
    const {frame} = await failed(args)

    expect(frame.error.message).toBe(message)
    expect(frame.error.name).toBe('CliError')
    expect((frame as {hint?: string}).hint).toBe(hint)
  })

  // A root option's value is read as the command, so the remedy is root help.
  it('-o json build names extension --help', async () => {
    const plain = await runCli(['-o', 'json', 'build'])

    expect(plain.status).toBe(1)
    expect(plain.stdout).toBe('')
    expect(plain.stderr).toBe(
      '⏵⏵⏵ Error: Unknown option -o.\n' +
        'Run extension --help to see the options.\n'
    )

    const {frame} = await failed(['-o', 'json', 'build', '--output', 'json'])

    expect(frame).toMatchObject({command: 'extension', status: 'usage'})
    expect(frame.error.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(frame.error.refs).toEqual({flag: '-o'})
  })

  it('build --browser --output json answers the missing --browser value', async () => {
    const {result, frame} = await failed([
      'build',
      '--browser',
      '--output',
      'json'
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Missing value for --browser.\n' +
        'Run extension build --help to see the options.\n'
    )

    expect(frame).toMatchObject({command: 'build', status: 'usage'})
    expect(frame.error.code).toBe('E_FLAG_VALUE_INVALID')
    expect(frame.error.refs).toEqual({flag: '--browser'})
  })

  // The trailing unknown flag ends the run inside dev's own parse.
  it('--browser chrome before dev is read as a dev flag', async () => {
    const {result, frame} = await failed([
      '--browser',
      'chrome',
      'dev',
      '--nope',
      '--output',
      'json'
    ])

    expect(result.status).toBe(1)
    expect(frame).toEqual({
      schema: 1,
      ok: false,
      command: 'dev',
      status: 'usage',
      value: null,
      error: {
        code: 'E_FLAG_NOT_SUPPORTED_HERE',
        message: 'Unknown option --nope.',
        name: 'CliError',
        refs: {flag: '--nope'}
      },
      warnings: [],
      hint: 'Did you mean --no-open?'
    })
  })

  // Pins current behavior: two error codes for one kind of mistake.
  it.each([
    [
      ['--since', 'nope'],
      'extension logs --since expects a sequence number or an ISO timestamp, got: nope'
    ],
    [
      ['--level', 'loud'],
      'extension logs --level expects one of off, error, warn, info, debug, trace, all, got: loud'
    ]
  ])('logs %j answers E_INVALID_OPTION where --tab answers E_FLAG_VALUE_INVALID', async (flag, message) => {
    const {result, frame} = await failed([
      'logs',
      '.',
      ...flag,
      '--output',
      'json'
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toBe(`${message}\n`)
    expect(frame).toEqual({
      schema: 1,
      ok: false,
      command: 'logs',
      status: 'usage',
      value: null,
      error: {code: 'E_INVALID_OPTION', message, name: 'CliError'},
      warnings: []
    })
  })

  it('keeps stdout empty without --output json', async () => {
    const result = await runCli(['nonexistent-cmd'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })

  it('renders a human unknown option without the native commander line', async () => {
    const result = await runCli(['build', '--frobnicate'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Unknown option --frobnicate.\n' +
        'Run extension build --help to see the options.\n'
    )
  })

  it('leaves an unknown flag failing on a command that takes --format', async () => {
    const result = await runCli(['capabilities', '--not-a-real-flag'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Unknown option --not-a-real-flag.\n' +
        'Run extension capabilities --help to see the options.\n'
    )
  })

  it('renders a human unknown command with the root help remedy', async () => {
    const result = await runCli(['nonexistent-cmd'])

    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Unknown command nonexistent-cmd.\n' +
        'Run extension --help to see the commands.\n'
    )
  })

  it('names create when the verb is init', async () => {
    const result = await runCli(['init'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Unknown command init.\n' +
        'Run extension create my-extension to start a new extension.\n'
    )
  })

  it('restyles the suggestion commander computed for a near-miss flag', async () => {
    const result = await runCli(['dev', '--brower'])

    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: Unknown option --brower.\nDid you mean --browser?\n'
    )
  })

  it('keeps --help and --version on exit 0 with no envelope', async () => {
    const help = await runCli(['--help'])

    expect(help.status).toBe(0)
    expect(help.stdout).toContain('Usage:')
    expect(help.stdout).not.toContain('"schema":1')
    expect(help.stderr).toBe('')

    const version = await runCli(['--version'])

    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/)
    expect(version.stderr).toBe('')
  })
})
