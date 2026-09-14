import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {registerBuildCommand} from '../commands/build'

function buildCommand() {
  const program = new Command()
  registerBuildCommand(program)
  const command = program.commands.find((cmd) => cmd.name() === 'build')
  if (!command) throw new Error('build command not registered')
  return command
}

describe('build --no-addon-lint negation', () => {
  it('registers both spellings', () => {
    const longFlags = buildCommand().options.map((option) => option.long)
    expect(longFlags).toContain('--addon-lint')
    expect(longFlags).toContain('--no-addon-lint')
  })

  it('leaves the option unset so config and the develop default decide', () => {
    const command = buildCommand()
    command.parseOptions([])
    expect(command.opts().addonLint).toBeUndefined()
  })

  it('parses --no-addon-lint as addonLint: false', () => {
    const command = buildCommand()
    command.parseOptions(['--no-addon-lint'])
    expect(command.opts().addonLint).toBe(false)
  })

  it('keeps the --addon-lint [boolean] spellings working', () => {
    for (const [argv, expected] of [
      [['--addon-lint'], true],
      [['--addon-lint', 'true'], true],
      [['--addon-lint', 'false'], false]
    ] as const) {
      const command = buildCommand()
      command.parseOptions([...argv])
      expect(command.opts().addonLint).toBe(expected)
    }
  })

  it('names the flag in the help catalog', async () => {
    const {programUserHelp} = await import('../helpers/messages')
    expect(programUserHelp()).toContain('--no-addon-lint')
  })
})
