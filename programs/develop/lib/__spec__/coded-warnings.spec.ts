import {describe, expect, it} from 'vitest'
import {recordCodedWarning, takeCodedWarnings} from '../coded-warnings'
import {CODES} from '../messaging'

describe('coded warnings', () => {
  it('hands back each recorded line once, code first, and then nothing', () => {
    takeCodedWarnings()

    recordCodedWarning(CODES.E_TYPES_EMIT, 'the first thing')
    recordCodedWarning(CODES.E_TYPES_EMIT, 'the first thing')
    recordCodedWarning(CODES.E_POLYFILL_NOT_FOUND, 'the second thing')

    expect(takeCodedWarnings()).toEqual([
      'E_TYPES_EMIT: the first thing',
      'E_POLYFILL_NOT_FOUND: the second thing'
    ])

    expect(takeCodedWarnings()).toEqual([])
  })

  it('records a shipped warning under its E_ name whichever name the caller passes', () => {
    takeCodedWarnings()

    recordCodedWarning(CODES.W_TYPES_EMIT, 'one thing')
    recordCodedWarning(CODES.E_TYPES_EMIT, 'one thing')
    recordCodedWarning(CODES.W_STORE_READINESS, 'another thing')

    expect(takeCodedWarnings()).toEqual([
      'E_TYPES_EMIT: one thing',
      'W_STORE_READINESS: another thing'
    ])
  })
})
