import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {type RunDeps, run} from '../run'

// Variables a run writes on the real process. Stubbed unset so each test
// starts clean and vi.unstubAllEnvs puts back what the file started with.
const ENV_A_RUN_WRITES = [
  'EXTENSION_DEVELOP_VERSION',
  'EXTENSION_CLI_UPDATE_SUFFIX',
  'EXTENSION_CLI_BANNER_PRINTED',
  'EXTENSION_NO_UPDATE_CHECK',
  'NO_UPDATE_NOTIFIER',
  'CI'
]

function fakeDeps() {
  const out: string[] = []
  const err: string[] = []
  const frames: unknown[] = []
  const exits: number[] = []
  const checkUpdates = vi.fn(async () => null)
  const deps: RunDeps = {
    exit: (code) => {
      exits.push(code)
    },
    stdout: (text) => {
      out.push(text)
    },
    stderr: (text) => {
      err.push(text)
    },
    writeFrame: (frame) => {
      frames.push(frame)
    },
    checkUpdates
  }

  return {
    deps,
    exits,
    frames,
    checkUpdates,
    stdout: () => stripVTControlCharacters(out.join('')),
    stderr: () => stripVTControlCharacters(err.join(''))
  }
}

const argv = (...args: string[]) => ['node', 'extension', ...args]

beforeEach(() => {
  for (const name of ENV_A_RUN_WRITES) vi.stubEnv(name, undefined)
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code}) reached the real process`)
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('run() in process', () => {
  it('prints the help for no arguments and exits 0', async () => {
    const fake = fakeDeps()

    expect(await run(argv(), fake.deps)).toBe(0)
    expect(fake.exits).toEqual([0])
    expect(fake.stdout()).toContain('Usage: extension')
    expect(fake.stderr()).toBe('')
  })

  it('prints the help for --help and exits 0', async () => {
    const fake = fakeDeps()

    expect(await run(argv('--help'), fake.deps)).toBe(0)
    expect(fake.exits).toEqual([0])
    expect(fake.stdout()).toContain('Usage: extension')
    expect(fake.stdout()).toContain('build')
  })

  it('refuses an unknown command with exit 1 on stderr', async () => {
    const fake = fakeDeps()

    expect(await run(argv('nope'), fake.deps)).toBe(1)
    expect(fake.exits).toEqual([1])
    expect(fake.stdout()).toBe('')
    expect(fake.stderr()).toContain('nope')
    expect(fake.frames).toEqual([])
  })

  it('refuses an unknown option with one frame under --output json', async () => {
    const fake = fakeDeps()

    expect(
      await run(argv('build', '--bogus', '--output', 'json'), fake.deps)
    ).toBe(1)

    expect(fake.exits).toEqual([1])
    expect(fake.stderr()).toContain('--bogus')
    expect(fake.frames).toEqual([
      expect.objectContaining({ok: false, command: 'build'})
    ])
  })

  it('refuses a removed flag before parsing', async () => {
    const fake = fakeDeps()

    expect(await run(argv('dev', '--no-runner'), fake.deps)).toBe(1)
    expect(fake.exits).toEqual([1])
    expect(fake.stderr()).toContain('--no-runner')
  })
})

describe('parse failures in run()', () => {
  it('sends an unknown root option with a value to the root help', async () => {
    const fake = fakeDeps()

    expect(
      await run(argv('-o', 'json', 'build', '--output', 'json'), fake.deps)
    ).toBe(1)

    expect(fake.stderr()).toBe(
      '⏵⏵⏵ Error: Unknown option -o.\n' +
        'Run extension --help to see the options.\n'
    )

    expect(fake.frames).toEqual([
      expect.objectContaining({
        command: 'extension',
        status: 'usage',
        error: {
          code: 'E_FLAG_NOT_SUPPORTED_HERE',
          message: 'Unknown option -o.',
          name: 'CliError',
          refs: {flag: '-o'}
        },
        hint: 'Run extension --help to see the options.'
      })
    ])
  })

  it('frames the copy stderr prints, with the remedy as the hint', async () => {
    const fake = fakeDeps()

    expect(
      await run(argv('dev', '--nope', '--output', 'json'), fake.deps)
    ).toBe(1)

    expect(fake.stderr()).toBe(
      '⏵⏵⏵ Error: Unknown option --nope.\nDid you mean --no-open?\n'
    )

    expect(fake.frames).toEqual([
      expect.objectContaining({
        command: 'dev',
        error: {
          code: 'E_FLAG_NOT_SUPPORTED_HERE',
          message: 'Unknown option --nope.',
          name: 'CliError',
          refs: {flag: '--nope'}
        },
        hint: 'Did you mean --no-open?'
      })
    ])
  })

  it.each([
    [['build', '--browser', '--output', 'json'], 'build', '--browser'],
    [['dev', '--browser', '--output', 'json'], 'dev', '--browser'],
    [['dev', '--output', 'json', '--browser'], 'dev', '--browser'],
    [['build', '--zip-filename', '--output', 'json'], 'build', '--zip-filename']
  ])('%j answers a flag left without its value', async (args, command, flag) => {
    const fake = fakeDeps()

    expect(await run(argv(...args), fake.deps)).toBe(1)
    expect(fake.stderr()).toBe(
      `⏵⏵⏵ Error: Missing value for ${flag}.\n` +
        `Run extension ${command} --help to see the options.\n`
    )

    expect(fake.frames).toEqual([
      expect.objectContaining({
        command,
        status: 'usage',
        error: {
          code: 'E_FLAG_VALUE_INVALID',
          message: `Missing value for ${flag}.`,
          name: 'CliError',
          refs: {flag}
        }
      })
    ])
  })

  // The trailing unknown flag stops the run inside the command's own parse,
  // which proves the flags typed first reached that command.
  it.each([
    [['--browser', 'chrome', 'dev', '--nope']],
    [['--browser=chrome', 'dev', '--nope']],
    [['--port', '3000', 'dev', '--nope']]
  ])('%j reads a command flag typed before the command', async (args) => {
    const fake = fakeDeps()

    expect(await run(argv(...args, '--output', 'json'), fake.deps)).toBe(1)
    expect(fake.frames).toEqual([
      expect.objectContaining({
        command: 'dev',
        error: expect.objectContaining({refs: {flag: '--nope'}})
      })
    ])
  })
})

describe('the deprecated --format alias in run()', () => {
  // The refusal exits through the command's own hook, which calls process.exit.
  it('names --format, the flag the user typed, when its value is refused', async () => {
    const lines: string[] = []

    vi.spyOn(console, 'error').mockImplementation((line) => {
      lines.push(stripVTControlCharacters(String(line)))
    })

    await run(argv('capabilities', '--format', 'bad'), fakeDeps().deps)

    const said = lines.join('\n')

    expect(said).toContain('--format got "bad". Use pretty or json.')
    expect(said).not.toContain('--output got')
  })
})

describe('the update check of run()', () => {
  it('starts for build', async () => {
    const fake = fakeDeps()

    await run(argv('build', '--bogus'), fake.deps)

    expect(fake.checkUpdates).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['under --output json', argv('build', '--bogus', '--output', 'json'), {}],
    [
      'for a command other than dev, start, preview, build',
      argv('doctor', '--bogus'),
      {}
    ],
    ['for help', argv('--help'), {}],
    [
      'with EXTENSION_NO_UPDATE_CHECK=1',
      argv('build', '--bogus'),
      {EXTENSION_NO_UPDATE_CHECK: '1'}
    ],
    [
      'with NO_UPDATE_NOTIFIER=1',
      argv('build', '--bogus'),
      {NO_UPDATE_NOTIFIER: '1'}
    ],
    ['under CI', argv('build', '--bogus'), {CI: 'true'}]
  ])('never starts %s', async (_name, args, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

    const fake = fakeDeps()

    await run(args, fake.deps)

    expect(fake.checkUpdates).not.toHaveBeenCalled()
  })

  it('hands a notice to the banner when it arrives first', async () => {
    const fake = fakeDeps()

    fake.checkUpdates.mockResolvedValueOnce({
      suffix: '(version 9.9.9 is available)',
      message: 'update'
    } as never)

    await run(argv('build', '--bogus'), fake.deps)
    await vi.waitFor(() =>
      expect(process.env.EXTENSION_CLI_UPDATE_SUFFIX).toBe(
        '(version 9.9.9 is available)'
      )
    )
  })
})
