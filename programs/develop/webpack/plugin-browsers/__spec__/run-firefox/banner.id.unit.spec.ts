import {describe, it, expect, vi} from 'vitest'
import {FirefoxRDPController} from '../../run-firefox/firefox-source-inspection/rdp-extension-controller'

describe('Firefox banner id (smoke)', () => {
  it('controller exposes methods used by setup', async () => {
    const ctrl = new FirefoxRDPController(
      {browser: 'firefox', extension: 'x'} as any,
      6000
    )
    expect(typeof (ctrl as any).ensureLoaded).toBe('function')
  })
})

