import {describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'

// A bare run shows a person the help. A machine that names no command gets
// the same answer as one frame: nothing ran, and where the commands are.
describe('extension --output json with no command', () => {
  it.each([
    [['--output', 'json']],
    [['--output=json']]
  ])('%j answers one coded frame that names no unknown option', async (args) => {
    const run = await runCli(args, {timeoutMs: 60_000, env: {NO_COLOR: '1'}})

    expect(everyLineAsFrame(run.stdout)).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'extension',
        status: 'usage',
        value: null,
        error: {
          code: 'E_ARGS',
          message:
            'No command was given. Run extension --help to see the commands.',
          name: 'CliError'
        },
        warnings: []
      }
    ])

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('No command was given.')
    expect(run.output).not.toContain('Unknown option')
  }, 90_000)

  it('still prints the help and exits 0 for a person', async () => {
    const run = await runCli([], {timeoutMs: 60_000, env: {NO_COLOR: '1'}})

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Usage: extension [options] [command]')
  }, 90_000)

  it('still prints the help when it is asked for beside the flag', async () => {
    const run = await runCli(['--output', 'json', '--help'], {
      timeoutMs: 60_000,
      env: {NO_COLOR: '1'}
    })

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Usage: extension [options] [command]')
  }, 90_000)
})
