import {afterEach, describe, expect, it, vi} from 'vitest'
import {toMachineText} from '../machine-text'
import {buildCommandFailed, buildWarningsDetails} from '../messages'
import {
  type Channel,
  ENVELOPE,
  hasChannelPrefix,
  prefix,
  stripChannelPrefix
} from '../messaging'
import {wrapStatsBlocks} from '../stats-handler'

// With color off the glyph is the same for every channel, so a warning and
// an error say their severity in a word. With color on nothing is added.

const GLYPH = '⏵⏵⏵'
const DEBUG_GLYPH = '···'
const CHANNELS: Channel[] = ['info', 'success', 'warn', 'error', 'debug']
const PAINTED: Record<Channel, string> = {
  info: `\u001b[90m${GLYPH}\u001b[39m`,
  success: `\u001b[32m${GLYPH}\u001b[39m`,
  warn: `\u001b[93m${GLYPH}\u001b[39m`,
  error: `\u001b[31m${GLYPH}\u001b[39m`,
  debug: `\u001b[2m\u001b[90m${DEBUG_GLYPH}\u001b[39m\u001b[22m`
}

function colorOff() {
  vi.stubEnv('FORCE_COLOR', undefined as unknown as string)
  vi.stubEnv('NO_COLOR', '1')
}

function colorOn() {
  vi.stubEnv('NO_COLOR', undefined as unknown as string)
  vi.stubEnv('FORCE_COLOR', '1')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('prefix with color on', () => {
  it.each(CHANNELS)('paints the %s glyph and adds no word', (channel) => {
    colorOn()

    expect(prefix(channel)).toBe(PAINTED[channel])
    expect(prefix(channel, 'Warning: own word')).toBe(PAINTED[channel])
  })
})

describe('prefix with color off', () => {
  it('says Warning: after the glyph on the warn channel', () => {
    colorOff()

    expect(prefix('warn')).toBe(`${GLYPH} Warning:`)
    expect(`${prefix('warn')} The folder moved.`).toBe(
      `${GLYPH} Warning: The folder moved.`
    )
  })

  it('says Error: after the glyph on the error channel', () => {
    colorOff()

    expect(prefix('error')).toBe(`${GLYPH} Error:`)
  })

  it.each(['info', 'success'] as const)('adds no word on %s', (channel) => {
    colorOff()

    expect(prefix(channel)).toBe(GLYPH)
    expect(prefix(channel, 'anything')).toBe(GLYPH)
  })

  it('adds no word on debug', () => {
    colorOff()

    expect(prefix('debug')).toBe(DEBUG_GLYPH)
  })

  it('still reads as a channel prefix', () => {
    colorOff()

    expect(hasChannelPrefix(`${prefix('warn')} text`)).toBe(true)
    expect(hasChannelPrefix(`${prefix('error')} text`)).toBe(true)
  })
})

describe('a line that names its own severity says it once', () => {
  it.each([
    ['warn', 'Warning 2: details were suppressed.'],
    ['warn', 'Warning: the request is an expression'],
    ['warn', 'Build warning in ./src/w.ts.'],
    ['warn', '\u001b[33mwarning\u001b[39m: lower case and painted'],
    ['error', 'Error: boom'],
    ['error', 'Build error in ./src/index.ts.']
  ] as const)('leaves the word off %s before "%s"', (channel, text) => {
    colorOff()

    expect(prefix(channel, text)).toBe(GLYPH)
  })

  it.each([
    ['warn', 'Performance: the bundle is large'],
    ['warn', 'Error: the other severity'],
    ['error', 'Warning: the other severity'],
    ['error', 'Errors were found.'],
    ['error', 'The build failed.']
  ] as const)('keeps the word on %s before "%s"', (channel, text) => {
    colorOff()

    expect(prefix(channel, text)).not.toBe(GLYPH)
  })

  // The compile summary says "with warnings" or "with errors" further in,
  // so its writer passes the severity and the line opens with the glyph alone.
  it('leaves the word off a compile summary that passes its severity', () => {
    colorOff()

    const warned = `${prefix('warn', 'Warning')} [12:00:00] Quote Keeper compiled with warnings in 82 ms.`
    const failed = `${prefix('error', 'Error')} [12:00:00] Quote Keeper compiled with errors in 82 ms.`

    expect(warned).toBe(
      `${GLYPH} [12:00:00] Quote Keeper compiled with warnings in 82 ms.`
    )

    expect(failed).toBe(
      `${GLYPH} [12:00:00] Quote Keeper compiled with errors in 82 ms.`
    )
  })

  it('renders bundler heads with one severity word each', () => {
    colorOff()

    const wrapped = wrapStatsBlocks(
      ['ERROR in ./src/a.ts', '  × broken', 'WARNING in ./src/w.ts'].join('\n')
    )

    expect(wrapped).toContain(`${GLYPH} Build error in ./src/a.ts.`)
    expect(wrapped).toContain(`${GLYPH} Build warning in ./src/w.ts.`)
    expect(wrapped).not.toMatch(/Error: Build|Warning: Build/)
  })

  it('frames a plain bundler warning with one severity word', () => {
    colorOff()

    const generic = buildWarningsDetails([{message: 'Something is off'}])
    const classified = buildWarningsDetails([
      {message: 'The manifest names a key this target lacks'}
    ])
    const suppressed = buildWarningsDetails([{}])

    expect(generic.split('\n')[0]).toBe(`${GLYPH} Warning: Something is off`)
    expect(classified.split('\n')[0]).toBe(
      `${GLYPH} Warning: Compatibility: The manifest names a key this target lacks`
    )

    expect(suppressed.split('\n')[0]).toBe(
      `${GLYPH} Warning 1: details were suppressed by tool output.`
    )
  })

  it('does not double the word of a thrown error', () => {
    colorOff()

    expect(buildCommandFailed('Error: boom')).toBe(`${GLYPH} Error: boom`)
    expect(buildCommandFailed(new Error('The disk is full'))).toBe(
      `${GLYPH} Error: The disk is full`
    )
  })

  it('prints a failure that framed itself as it came', () => {
    colorOff()

    const framed = `${prefix('error', 'Build error')} Build error in ./a.ts.`

    expect(buildCommandFailed(new Error(framed))).toBe(framed)
  })
})

describe('a block of several lines', () => {
  it('carries the word on the first line only', () => {
    colorOff()

    const block =
      `${prefix('warn')} The public folder sits in a legacy place.\n` +
      'GOT src/public\n' +
      'EXPECTED public'

    expect(block.split('\n')).toEqual([
      `${GLYPH} Warning: The public folder sits in a legacy place.`,
      'GOT src/public',
      'EXPECTED public'
    ])
  })

  it('leaves the gutter lines of a framed warning alone', () => {
    colorOff()

    const lines = buildWarningsDetails([
      {message: 'Something is off', moduleName: './src/a.js'}
    ]).split('\n')

    expect(lines[0]).toMatch(new RegExp(`^${GLYPH} Warning: `))
    expect(lines.slice(1).join('\n')).not.toMatch(/Warning:|Error:/)
    expect(lines.slice(1).every((line) => !line.includes(GLYPH))).toBe(true)
  })
})

describe('machine text carries neither the glyph nor the added word', () => {
  it.each([
    ['off', colorOff],
    ['on', colorOn]
  ] as const)('strips what prefix wrote with color %s', (_name, mode) => {
    mode()

    expect(stripChannelPrefix(`${prefix('warn')} The folder moved.`)).toBe(
      'The folder moved.'
    )

    expect(stripChannelPrefix(`${prefix('error')} It failed.\nGOT x`)).toBe(
      'It failed.\nGOT x'
    )

    expect(stripChannelPrefix(`${prefix('info')} Built.`)).toBe('Built.')
    expect(toMachineText(`${prefix('warn')} The folder moved.\nGOT x`)).toBe(
      'The folder moved.\nGOT x'
    )

    expect(toMachineText(`  ⚠ ${prefix('error')} It failed.`)).toBe(
      'It failed.'
    )
  })

  it('keeps a severity word that belongs to the message', () => {
    colorOff()

    expect(stripChannelPrefix('Warning: no glyph before this one')).toBe(
      'Warning: no glyph before this one'
    )

    expect(stripChannelPrefix(`${GLYPH} Warning 2: suppressed`)).toBe(
      'Warning 2: suppressed'
    )

    expect(stripChannelPrefix(`${GLYPH} Build error in ./a.ts.`)).toBe(
      'Build error in ./a.ts.'
    )

    expect(
      stripChannelPrefix(`${prefix('error')} It failed. Error: ENOENT`)
    ).toBe('It failed. Error: ENOENT')

    expect(toMachineText('Warning: said by the compiler')).toBe(
      'Warning: said by the compiler'
    )

    expect(toMachineText(`${GLYPH} Build warning in ./w.ts.`)).toBe(
      'Build warning in ./w.ts.'
    )
  })

  it('keeps the word off an envelope error, nested glyph included', () => {
    colorOff()

    const nested =
      `${prefix('error')} Dev mode failed.\n` +
      `REASON ${prefix('error')} The port is taken.`
    const frame = ENVELOPE.fail('dev', 'failed', {
      code: 'E_INTERNAL',
      message: nested
    })

    expect(frame.error?.message).toBe(
      'Dev mode failed.\nREASON The port is taken.'
    )
  })
})
