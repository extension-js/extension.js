import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {registerBuildCommand} from '../commands/build'
import {programUserHelp} from '../helpers/messages'

function buildCommand() {
  const program = new Command()
  registerBuildCommand(program)
  const command = program.commands.find((cmd) => cmd.name() === 'build')
  if (!command) throw new Error('build command not registered')

  return command
}

describe('build --zip-dir and --source-maps', () => {
  it('registers both flags with help that says where the zip goes and what the maps cost', () => {
    const options = buildCommand().options
    const zipDir = options.find((option) => option.long === '--zip-dir')
    const sourceMaps = options.find((option) => option.long === '--source-maps')

    expect(zipDir?.description).toContain('relative to the project root')
    expect(zipDir?.description).toContain('Defaults to')
    expect(sourceMaps?.description).toContain('stay out of the ZIP file')
    expect(sourceMaps?.description).toContain('Defaults to `false`')
  })

  it('leaves both unset so commands.build decides', () => {
    const command = buildCommand()
    command.parseOptions([])
    expect(command.opts().zipDir).toBeUndefined()
    expect(command.opts().sourceMaps).toBeUndefined()
  })

  it('reads every --source-maps spelling', () => {
    for (const [argv, expected] of [
      [['--source-maps'], true],
      [['--source-maps', 'true'], true],
      [['--source-maps', 'false'], false]
    ] as const) {
      const command = buildCommand()
      command.parseOptions([...argv])
      expect(command.opts().sourceMaps).toBe(expected)
    }
  })

  it('lists both in the top-level help', () => {
    expect(programUserHelp()).toContain('--zip-dir')
    expect(programUserHelp()).toContain('--source-maps')
  })
})
