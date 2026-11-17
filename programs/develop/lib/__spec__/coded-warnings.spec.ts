import {describe, expect, it} from 'vitest'
import {recordCodedWarning, takeCodedWarnings} from '../coded-warnings'
import {CODES} from '../messaging'

describe('coded warnings', () => {
  it('hands back each recorded line once, code first, and then nothing', () => {
    takeCodedWarnings()

    recordCodedWarning(CODES.W_TYPES_EMIT, 'the first thing')
    recordCodedWarning(CODES.W_TYPES_EMIT, 'the first thing')
    recordCodedWarning(CODES.W_POLYFILL_NOT_FOUND, 'the second thing')

    expect(takeCodedWarnings()).toEqual([
      'W_TYPES_EMIT: the first thing',
      'W_POLYFILL_NOT_FOUND: the second thing'
    ])

    expect(takeCodedWarnings()).toEqual([])
  })
})
