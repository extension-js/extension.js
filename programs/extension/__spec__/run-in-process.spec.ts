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
