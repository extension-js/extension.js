import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {
  explicitCliValue,
  explicitOptionalBoolean,
  isExplicitCliOption
} from '../cli-explicit'
import {parseOptionalBoolean} from '../vendors'

function makeCommand() {
  return new Command('x')
    .option('--no-open')
    .option('--no-log-color')
    .option('--polyfill [boolean]', '', parseOptionalBoolean)
    .option('--no-polyfill')
}

describe('cli-explicit helpers', () => {
  it('reports commander defaults as not explicit', () => {
    const command = makeCommand()
    command.parse([], {from: 'user'})

    // Negated options set a default value even when absent. That default
    // must not read as a user decision.
    expect(command.opts().open).toBe(true)
    expect(isExplicitCliOption(command, 'open')).toBe(false)
    expect(isExplicitCliOption(command, 'logColor')).toBe(false)
    expect(isExplicitCliOption(command, 'polyfill')).toBe(false)
    expect(
      explicitCliValue(command, 'open', command.opts().open === false)
    ).toBeUndefined()
    expect(
      explicitCliValue(command, 'logColor', command.opts().logColor)
    ).toBeUndefined()
  })

  it('reports typed flags as explicit and returns their value', () => {
    const command = makeCommand()
    command.parse(['--no-open', '--no-log-color', '--no-polyfill'], {
      from: 'user'
    })

    expect(isExplicitCliOption(command, 'open')).toBe(true)
    expect(
      explicitCliValue(command, 'open', command.opts().open === false)
    ).toBe(true)
    expect(explicitCliValue(command, 'logColor', command.opts().logColor)).toBe(
      false
    )
    expect(isExplicitCliOption(command, 'polyfill')).toBe(true)
    expect(command.opts().polyfill).toBe(false)
  })

  it('treats --flag value spellings as explicit', () => {
    const command = makeCommand()
    command.parse(['--polyfill', 'false'], {from: 'user'})

    expect(isExplicitCliOption(command, 'polyfill')).toBe(true)
    expect(command.opts().polyfill).toBe(false)
  })

  it('coerces optional booleans without inventing a default', () => {
    expect(explicitOptionalBoolean(undefined)).toBeUndefined()
    expect(explicitOptionalBoolean(true)).toBe(true)
    expect(explicitOptionalBoolean(false)).toBe(false)
    expect(explicitOptionalBoolean('false')).toBe(false)
    expect(explicitOptionalBoolean('true')).toBe(true)
    expect(explicitOptionalBoolean('0')).toBe(false)
    expect(explicitOptionalBoolean('off')).toBe(false)
    expect(explicitOptionalBoolean('on')).toBe(true)
  })
})
