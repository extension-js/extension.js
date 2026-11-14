import {describe, expect, it} from 'vitest'
import {lateBootRegistration} from '../messages'

const ANSI = /\u001b\[[0-9;]*m/g

describe('the line for a registration that landed after the first page', () => {
  it('is one line that says when it landed and what to do', () => {
    const line = lateBootRegistration(1240).replace(ANSI, '')

    expect(line).toContain('1.2s after it started')
    expect(line).toContain('reload it')
    expect(line).not.toContain('\n')
  })

  it('still reads as a sentence when the background gave no time', () => {
    const line = lateBootRegistration().replace(ANSI, '')

    expect(line).toContain('a content script after it started,')
    expect(line).not.toContain('undefined')
    expect(line).not.toContain('NaN')
  })
})
