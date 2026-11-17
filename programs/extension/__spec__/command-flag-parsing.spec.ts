import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {registerBuildCommand} from '../commands/build'
import {registerDevCommand} from '../commands/dev'
import {registerStartCommand} from '../commands/start'
import {programUserHelp} from '../helpers/messages'

type Register = (program: Command) => void

function commandNamed(register: Register, name: string) {
  const program = new Command()
  register(program)
  const command = program.commands.find((cmd) => cmd.name() === name)
  if (!command) throw new Error(`command ${name} not registered`)

  return command
}

function parsed(register: Register, name: string, argv: string[]) {
  const command = commandNamed(register, name)
  command.parseOptions(argv)

  return command.opts()
}

// Each row: the command, the flag, the key it parses to and how it registers.
const NEGATABLE_FLAGS = [
  ['build', 'addon-lint', 'addonLint', registerBuildCommand],
  ['build', 'minify', 'minify', registerBuildCommand],
  ['build', 'polyfill', 'polyfill', registerBuildCommand],
  ['dev', 'polyfill', 'polyfill', registerDevCommand],
  ['start', 'polyfill', 'polyfill', registerStartCommand]
] as const

describe.each(
  NEGATABLE_FLAGS
)('%s --%s and its negation', (name, flag, key, register) => {
  it('registers both spellings', () => {
    const longFlags = commandNamed(register, name).options.map(
      (option) => option.long
    )

    expect(longFlags).toContain(`--${flag}`)
    expect(longFlags).toContain(`--no-${flag}`)
  })

  it('leaves the option unset so config and the default decide', () => {
    expect(parsed(register, name, [])[key]).toBeUndefined()
  })

  it('parses the negation as false', () => {
    expect(parsed(register, name, [`--no-${flag}`])[key]).toBe(false)
  })

  it.each([
    [[], true],
    [['true'], true],
    [['false'], false]
  ] as const)('reads the value %j as %s', (value, expected) => {
    expect(parsed(register, name, [`--${flag}`, ...value])[key]).toBe(expected)
  })
})

describe('build --zip-dir and --source-maps', () => {
  it('registers both flags with help that says where the zip goes and what the maps cost', () => {
    const options = commandNamed(registerBuildCommand, 'build').options
    const zipDir = options.find((option) => option.long === '--zip-dir')
    const sourceMaps = options.find((option) => option.long === '--source-maps')

    expect(zipDir?.description).toContain('relative to the project root')
    expect(zipDir?.description).toContain('Defaults to')
    expect(sourceMaps?.description).toContain('stay out of the ZIP file')
    expect(sourceMaps?.description).toContain('Defaults to `false`')
  })

  it('leaves both unset so commands.build decides', () => {
    const options = parsed(registerBuildCommand, 'build', [])

    expect(options.zipDir).toBeUndefined()
    expect(options.sourceMaps).toBeUndefined()
  })

  it.each([
    [[], true],
    [['true'], true],
    [['false'], false]
  ] as const)('reads the --source-maps value %j as %s', (value, expected) => {
    expect(
      parsed(registerBuildCommand, 'build', ['--source-maps', ...value])
        .sourceMaps
    ).toBe(expected)
  })
})

describe('the top-level help', () => {
  it.each([
    '--no-addon-lint',
    '--zip-dir',
    '--source-maps'
  ])('lists %s', (flag) => {
    expect(programUserHelp()).toContain(flag)
  })
})
