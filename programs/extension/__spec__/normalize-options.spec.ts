import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {LOG_CONTEXTS as BRIDGE_LOG_CONTEXTS} from '../../develop/dev-server/control-bridge/contracts'
import {LOG_CONTEXTS} from '../helpers/log-contexts'
import {
  firstInvalidWholeNumberFlag,
  isValidWholeNumberFlag,
  parseExtensionsList,
  LOG_LEVELS,
  parseLogContexts,
  parseLogLevel,
  parsePositiveInt,
  parseWholeNumber
} from '../helpers/normalize-options'

describe('parseExtensionsList', () => {
  it('returns undefined for empty input', () => {
    expect(parseExtensionsList(undefined)).toBeUndefined()
    expect(parseExtensionsList('')).toBeUndefined()
    expect(parseExtensionsList('   ')).toBeUndefined()
  })

  it('splits comma-separated values and trims whitespace', () => {
    expect(parseExtensionsList(' a, b ,c ')).toEqual(['a', 'b', 'c'])
  })
})

// The engine turns logging on for any level but the exact word off, so a
// level typed in capitals has to reach it as the listed name.
describe('parseLogLevel', () => {
  it.each(LOG_LEVELS)('hands %s to the engine as it is listed', (level) => {
    expect(parseLogLevel(level)).toBe(level)
    expect(parseLogLevel(` ${level.toUpperCase()} `)).toBe(level)
  })

  it('reads a blank or unlisted value as no level', () => {
    expect(parseLogLevel(undefined)).toBeUndefined()
    expect(parseLogLevel('')).toBeUndefined()
    expect(parseLogLevel('verbose')).toBeUndefined()
  })

  it.each([
    'dev',
    'start',
    'preview'
  ])('lists the levels the --logs flag of %s declares', (command) => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'commands', `${command}.ts`),
      'utf8'
    )

    expect(source).toContain(`'--logs <${LOG_LEVELS.join('|')}>'`)
  })
})

describe('parsePositiveInt', () => {
  it('treats an absent or blank value as unset', () => {
    expect(parsePositiveInt('--tab', undefined)).toEqual({
      ok: true,
      value: undefined
    })

    expect(parsePositiveInt('--tab', '  ')).toEqual({
      ok: true,
      value: undefined
    })
  })

  it('accepts a whole positive number', () => {
    expect(parsePositiveInt('--timeout', ' 250 ')).toEqual({
      ok: true,
      value: 250
    })

    expect(parsePositiveInt('--tab', 7)).toEqual({ok: true, value: 7})
  })

  it('refuses text, negatives, zero and fractions by flag name', () => {
    for (const raw of ['abc', '-5', '0', '1.5', '1e3', 'Infinity']) {
      expect(parsePositiveInt('--max-bytes', raw)).toEqual({
        ok: false,
        message: `--max-bytes expects a positive integer, got: ${raw}`
      })
    }
  })
})

describe('whole number flags', () => {
  it.each([
    ['--port', '0', true],
    ['--port', '65535', true],
    ['--port', '65536', false],
    ['--port', '-1', false],
    ['--port', '1.5', false],
    ['--port', 'abc', false],
    ['--port', '', false],
    ['--wait-timeout', ' 10000 ', true],
    ['--wait-timeout', '0', false],
    ['--wait-timeout', '10s', false],
    ['--wait-timeout', '1e3', false],
    ['--parent-pid', '4242', true],
    ['--parent-pid', '0', false],
    ['--parent-pid', '12abc', false]
  ] as const)('reads %s %j as valid: %s', (flag, raw, valid) => {
    expect(isValidWholeNumberFlag(flag, raw)).toBe(valid)
  })

  it('names the first typed flag that is refused, skipping untyped ones', () => {
    expect(
      firstInvalidWholeNumberFlag([
        ['--port', undefined],
        ['--wait-timeout', '5000'],
        ['--parent-pid', 'x'],
        ['--port', 'y']
      ])
    ).toEqual(['--parent-pid', 'x'])

    expect(firstInvalidWholeNumberFlag([['--port', '0']])).toBeUndefined()
  })

  it('parses digits only', () => {
    expect(parseWholeNumber('007')).toBe(7)
    expect(parseWholeNumber(42)).toBe(42)
    expect(parseWholeNumber('9'.repeat(20))).toBeUndefined()
    expect(parseWholeNumber(undefined)).toBeUndefined()
  })
})

// One vocabulary for every log filter: what `dev --log-context` takes is
// what `logs --context` and the bridge query take, `page` included.
describe('parseLogContexts', () => {
  it('reads the shared context list, as the bridge names it', () => {
    expect(LOG_CONTEXTS).toEqual([...BRIDGE_LOG_CONTEXTS])
    expect(LOG_CONTEXTS).toContain('page')
    expect(parseLogContexts('page,newtab,background')).toEqual([
      'page',
      'newtab',
      'background'
    ])
  })

  it('drops names outside the list and treats all or blank as every context', () => {
    expect(parseLogContexts('content, nope ,popup')).toEqual([
      'content',
      'popup'
    ])

    expect(parseLogContexts('nope')).toBeUndefined()
    expect(parseLogContexts('all')).toBeUndefined()
    expect(parseLogContexts('')).toBeUndefined()
    expect(parseLogContexts(undefined)).toBeUndefined()
  })
})
