import {describe, it, expect} from 'vitest'
import {Command} from 'commander'
import {parseOptionalBoolean} from '../vendors'
import {registerBuildCommand} from '../../commands/build'
import {registerDevCommand} from '../../commands/dev'
import {registerStartCommand} from '../../commands/start'

function coercionFor(
  register: (program: Command) => void,
  name: string,
  long: string
) {
  const program = new Command()
  register(program)
  const cmd = program.commands.find((c) => c.name() === name)!
  const option = cmd.options.find((o) => o.long === long)
  return option?.parseArg as ((v?: string) => unknown) | undefined
}

describe('parseOptionalBoolean', () => {
  it('treats a bare flag as true and false/0/no/off as false', () => {
    expect(parseOptionalBoolean(undefined)).toBe(true)
    for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
      expect(parseOptionalBoolean(v)).toBe(false)
    }
    for (const v of ['true', '1', 'yes']) {
      expect(parseOptionalBoolean(v)).toBe(true)
    }
  })
})

describe('optional [boolean] flags coerce their value, not the raw string', () => {
  const cases: Array<[string, (p: Command) => void, string[]]> = [
    ['build', registerBuildCommand, ['--polyfill', '--zip', '--zip-source', '--silent']],
    ['dev', registerDevCommand, ['--polyfill']],
    ['start', registerStartCommand, ['--polyfill']]
  ]

  for (const [name, register, flags] of cases) {
    for (const long of flags) {
      it(`${name} ${long} parses "false" as false (not a truthy string)`, () => {
        const coerce = coercionFor(register, name, long)
        expect(typeof coerce).toBe('function')
        expect(coerce!('false')).toBe(false)
        expect(coerce!(undefined)).toBe(true)
      })
    }
  }
})
