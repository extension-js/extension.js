import {describe, it, expect} from 'vitest'
import {createFirefoxContext} from '../../run-firefox/firefox-context'

describe('Firefox temp state cleanup (smoke)', () => {
  it('clears pending reason', () => {
    const ctx = createFirefoxContext()
    ctx.setPendingReloadReason('manifest')
    expect(ctx.getPendingReloadReason()).toBe('manifest')
    ctx.clearPendingReloadReason()
    expect(ctx.getPendingReloadReason()).toBeUndefined()
  })
})

