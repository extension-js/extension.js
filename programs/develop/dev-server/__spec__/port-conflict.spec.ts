import {describe, expect, it} from 'vitest'
import {shouldWarnPortConflict} from '../messages'

describe('shouldWarnPortConflict', () => {
  it('stays silent for an ephemeral port request', () => {
    expect(shouldWarnPortConflict(0, 37237)).toBe(false)
    expect(shouldWarnPortConflict('0', 37237)).toBe(false)
  })

  it('warns when a fixed port was taken', () => {
    expect(shouldWarnPortConflict(8080, 8081)).toBe(true)
    expect(shouldWarnPortConflict('8080', 8081)).toBe(true)
  })

  it('stays silent when the requested port was granted', () => {
    expect(shouldWarnPortConflict(8080, 8080)).toBe(false)
    expect(shouldWarnPortConflict('8080', 8080)).toBe(false)
  })

  it('stays silent when no port was requested', () => {
    expect(shouldWarnPortConflict(undefined, 8080)).toBe(false)
    expect(shouldWarnPortConflict('', 8080)).toBe(false)
  })
})
