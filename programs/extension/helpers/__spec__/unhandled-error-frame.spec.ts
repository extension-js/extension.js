import {afterEach, describe, expect, it, vi} from 'vitest'
import {unhandledError} from '../messages'
import {CODES, hasChannelPrefix, prefix} from '../messaging'

const ANSI = /\[[0-9;]*m/g
const GLYPH = '⏵⏵⏵'
const plain = (text: string) => text.replace(ANSI, '')

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the last frame a failure passes through', () => {
  it('prints a command-rendered block exactly as the command wrote it', () => {
    const rendered = `${prefix('error')} my-extension already contains files that would be overwritten.\nRemove or rename them, or choose a different directory name.`

    const printed = unhandledError(new Error(rendered))

    expect(printed).toBe(rendered)
    expect(plain(printed).match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
    expect(plain(printed).match(/Error: /g)).toHaveLength(1)
    expect(printed).not.toContain('    at ')
  })

  it('recognises a rendered block that still carries its color codes', () => {
    // The check strips ANSI before looking for the glyph, and a terminal
    // session hands it the colored form. Built from explicit escapes so the
    // case holds whether or not colors are enabled where the spec runs.
    const ESC = String.fromCharCode(27)
    const rendered = `${ESC}[31m${GLYPH}${ESC}[39m my-extension already contains files`

    expect(unhandledError(new Error(rendered))).toBe(rendered)
  })

  it('still frames an internal throw, with its stack, so a bug stays debuggable', () => {
    const error = new Error('read ECONNRESET')

    const printed = plain(unhandledError(error))

    expect(hasChannelPrefix(printed)).toBe(true)
    expect(printed).toContain('read ECONNRESET')
    expect(printed).toContain('    at ')
  })

  it.each([
    [
      'Unable to locate the extension-develop runtime.',
      CODES.E_RUNTIME_NOT_FOUND
    ],
    [
      'Local extension-develop runtime is not built.',
      CODES.E_RUNTIME_NOT_FOUND
    ],
    ['manifest.json is missing.', CODES.E_MANIFEST_NOT_FOUND]
  ])('prints a coded refusal as one line with no stack: %s', (message, code) => {
    vi.stubEnv('EXTENSION_DEBUG', undefined)

    const printed = plain(
      unhandledError(Object.assign(new Error(message), {code}))
    )

    expect(printed).toBe(`${GLYPH} Error: ${message}`)
  })

  it('keeps the stack of a coded refusal under EXTENSION_DEBUG', () => {
    vi.stubEnv('EXTENSION_DEBUG', '1')

    const error = Object.assign(new Error('no runtime'), {
      code: CODES.E_RUNTIME_NOT_FOUND
    })

    expect(plain(unhandledError(error))).toContain('    at ')
  })

  it.each([
    ['E_INTERNAL', CODES.E_INTERNAL],
    ['a code outside the catalog', 'ENOENT'],
    ['an inherited object key', 'toString']
  ])('keeps the stack of an error coded %s', (_label, code) => {
    vi.stubEnv('EXTENSION_DEBUG', undefined)

    const error = Object.assign(new Error('boom'), {code})

    expect(plain(unhandledError(error))).toContain('    at ')
  })

  it('says Error: once on an unhandled crash when color is off', () => {
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string)
    vi.stubEnv('NO_COLOR', '1')

    try {
      const head = unhandledError(new Error('read ECONNRESET')).split('\n')[0]

      expect(head).toBe(`${GLYPH} Error: read ECONNRESET`)
      expect(unhandledError('Error: boom')).toBe(`${GLYPH} Error: boom`)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('frames a thrown string and an unknown value the same way', () => {
    expect(plain(unhandledError('boom'))).toBe(`${GLYPH} Error: boom`)
    expect(plain(unhandledError(undefined))).toContain('Unknown error')
  })
})
