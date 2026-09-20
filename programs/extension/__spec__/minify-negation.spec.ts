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

describe('build --no-minify negation', () => {
  it('registers both spellings', () => {
    const longFlags = buildCommand().options.map((option) => option.long)
    expect(longFlags).toContain('--minify')
    expect(longFlags).toContain('--no-minify')
  })

  it('leaves the option unset so config and the per-target default decide', () => {
    const command = buildCommand()
    command.parseOptions([])
    expect(command.opts().minify).toBeUndefined()
  })

  it('parses --no-minify as minify: false', () => {
    const command = buildCommand()
    command.parseOptions(['--no-minify'])
    expect(command.opts().minify).toBe(false)
  })

  it('keeps the --minify [boolean] spellings working', () => {
    for (const [argv, expected] of [
      [['--minify'], true],
      [['--minify', 'true'], true],
      [['--minify', 'false'], false]
    ] as const) {
      const command = buildCommand()
      command.parseOptions([...argv])
      expect(command.opts().minify).toBe(expected)
    }
  })
})
