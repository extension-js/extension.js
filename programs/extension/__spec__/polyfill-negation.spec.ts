import {describe, it, expect} from 'vitest'
import {Command} from 'commander'
import {registerDevCommand} from '../commands/dev'
import {registerBuildCommand} from '../commands/build'
import {registerStartCommand} from '../commands/start'

function commandNamed(register: (program: Command) => void, name: string) {
  const program = new Command()
  register(program)
  const command = program.commands.find((cmd) => cmd.name() === name)
  if (!command) throw new Error(`command ${name} not registered`)
  return command
}

describe.each([
  ['dev', registerDevCommand],
  ['build', registerBuildCommand],
  ['start', registerStartCommand]
] as const)('%s --no-polyfill negation', (name, register) => {
  it('registers the --no-polyfill negation', () => {
    const command = commandNamed(register, name)
    const longFlags = command.options.map((option) => option.long)
    expect(longFlags).toContain('--no-polyfill')
    expect(longFlags).toContain('--polyfill')
  })

  it('parses --no-polyfill as polyfill: false', () => {
    const command = commandNamed(register, name)
    command.parseOptions(['--no-polyfill'])
    expect(command.opts().polyfill).toBe(false)
  })

  it('keeps the --polyfill [boolean] spellings working', () => {
    for (const [argv, expected] of [
      [['--polyfill'], true],
      [['--polyfill', 'true'], true],
      [['--polyfill', 'false'], false]
    ] as const) {
      const command = commandNamed(register, name)
      command.parseOptions([...argv])
      expect(command.opts().polyfill).toBe(expected)
    }
  })
})
