import {describe, it, expect} from 'vitest'
import {createFirefoxContext} from '../../run-firefox/firefox-context'

describe('Firefox controller facade (smoke)', () => {
  it('notifies onControllerReady when set', () => {
    const ctx = createFirefoxContext()
    let seen = false
    ctx.onControllerReady(() => {
      seen = true
    })
    // @ts-expect-error: providing a minimal mock controller
    ctx.setController({} as any, 6000)
    expect(seen).toBe(true)
  })
})

