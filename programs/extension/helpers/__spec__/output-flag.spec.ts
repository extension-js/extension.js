import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// The warn-once latch is module state, so every test imports a fresh copy.
async function freshModule() {
  vi.resetModules()

  return import('../output-flag')
}

function notice(flag: string): string {
  return (
    `⏵⏵⏵ ${flag} is deprecated and maps to --output.\n` +
    'Pass --output <pretty|json> instead.'
  )
}

let stderr: string[]

beforeEach(() => {
  stderr = []
  vi.spyOn(console, 'error').mockImplementation((line) => {
    stderr.push(stripVTControlCharacters(String(line)))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface ResolveRow {
  name: string
  opts: {output?: string; format?: string; waitFormat?: string}
  format: 'pretty' | 'json'
  stderr: string[]
}

const RESOLVE_ROWS: ResolveRow[] = [
  {name: 'nothing passed', opts: {}, format: 'pretty', stderr: []},
  {name: '--output', opts: {output: 'json'}, format: 'json', stderr: []},
  {
    name: 'the --wait-format alias',
    opts: {waitFormat: 'json'},
    format: 'json',
    stderr: [notice('--wait-format')]
  },
  {
    name: 'the --format alias',
    opts: {format: 'json'},
    format: 'json',
    stderr: [notice('--format')]
  },
  {
    name: 'both aliases, where --format comes first',
    opts: {format: 'json', waitFormat: 'pretty'},
    format: 'json',
    stderr: [notice('--format')]
  },
  {
    name: 'an unreadable --format beside a readable --wait-format',
    opts: {format: 'yaml', waitFormat: 'json'},
    format: 'json',
    stderr: [notice('--wait-format')]
  },
  {
    name: 'an explicit --output beside an alias',
    opts: {output: 'pretty', waitFormat: 'json'},
    format: 'pretty',
    stderr: []
  },
  {
    name: 'values no parser recognizes',
    opts: {output: 'bogus', waitFormat: 'nope'},
    format: 'pretty',
    stderr: []
  },
  {
    name: 'a value in another case and with spaces',
    opts: {output: ' JSON '},
    format: 'json',
    stderr: []
  }
]

describe('resolveOutputFormat', () => {
  it.each(RESOLVE_ROWS)('reads $name', async (row) => {
    const {isJsonOutput, resolveOutputFormat} = await freshModule()

    expect(resolveOutputFormat(row.opts)).toBe(row.format)
    expect(stderr).toEqual(row.stderr)
    expect(isJsonOutput(row.opts)).toBe(row.format === 'json')
  })

  it('warns once per process, not once per alias', async () => {
    const {resolveOutputFormat} = await freshModule()

    expect(resolveOutputFormat({format: 'json', waitFormat: 'json'})).toBe(
      'json'
    )

    expect(resolveOutputFormat({waitFormat: 'pretty'})).toBe('pretty')
    expect(stderr).toEqual([notice('--format')])
  })
})

describe('invalidOutputFlagMessage', () => {
  it.each([
    [{}, undefined],
    [{output: ' Json '}, undefined],
    [{output: 'jsno'}, '--output got "jsno". Use pretty or json.'],
    [{format: 'yaml'}, '--format got "yaml". Use pretty or json.'],
    [{waitFormat: ''}, '--wait-format got "". Use pretty or json.'],
    [
      {output: 'json', waitFormat: 'nope'},
      '--wait-format got "nope". Use pretty or json.'
    ],
    [
      {output: 'bad', waitFormat: 'nope'},
      '--output got "bad". Use pretty or json.'
    ]
  ])('reads %j as %j', async (opts, message) => {
    const {invalidOutputFlagMessage} = await freshModule()

    expect(invalidOutputFlagMessage(opts)).toBe(message)
  })
})

describe('normalizeOutputFormat', () => {
  it.each([
    ['JSON', 'json'],
    [' json ', 'json'],
    ['Pretty', 'pretty'],
    ['yaml', undefined],
    [undefined, undefined],
    [42, undefined]
  ])('reads %j as %j', async (value, format) => {
    const {normalizeOutputFormat} = await freshModule()

    expect(normalizeOutputFormat(value)).toBe(format)
  })
})
