import {describe, expect, it} from 'vitest'
import {unhandledError} from '../messages'
import {hasChannelPrefix, prefix} from '../messaging'

const ANSI = /\[[0-9;]*m/g
const GLYPH = '⏵⏵⏵'
const plain = (text: string) => text.replace(ANSI, '')

describe('the last frame a failure passes through', () => {
  it('prints a command-rendered block exactly as the command wrote it', () => {
    const rendered = `${prefix('error')} my-extension already contains files that would be overwritten.\nRemove or rename them, or choose a different directory name.`

    const printed = unhandledError(new Error(rendered))

    expect(printed).toBe(rendered)
    expect(plain(printed).match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
    expect(printed).not.toContain('Error: ')
    expect(printed).not.toContain('    at ')
  })

  it('still frames an internal throw, with its stack, so a bug stays debuggable', () => {
    const error = new Error('read ECONNRESET')

    const printed = plain(unhandledError(error))

    expect(hasChannelPrefix(printed)).toBe(true)
    expect(printed).toContain('read ECONNRESET')
    expect(printed).toContain('    at ')
  })

  it('frames a thrown string and an unknown value the same way', () => {
    expect(plain(unhandledError('boom'))).toBe(`${GLYPH} boom`)
    expect(plain(unhandledError(undefined))).toContain('Unknown error')
  })
})
