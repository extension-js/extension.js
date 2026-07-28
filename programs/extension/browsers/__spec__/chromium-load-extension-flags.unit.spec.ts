import {describe, expect, it} from 'vitest'
import {loadUnpacked} from '../run-chromium/cdp/cdp-extension-controller/ensure'
import {DEFAULT_BROWSER_FLAGS} from '../run-chromium/chromium-launch/browser-config'

const flags = DEFAULT_BROWSER_FLAGS.map((flag) => String(flag))

function cdpThatFailsWith(code: number, message: string) {
  return {
    sendCommand: async () => {
      throw new Error(JSON.stringify({code, message}))
    }
  } as never
}

describe('chromium load-extension launch flags', () => {
  it('disables the switch policy that makes Chrome ignore --load-extension', () => {
    expect(flags).toContain(
      '--disable-features=DisableLoadExtensionCommandLineSwitch'
    )
  })

  it('keeps the flag that allows CDP extension debugging', () => {
    expect(flags).toContain('--enable-unsafe-extension-debugging')
  })

  it('keeps the flag that survives a developer-mode reload', () => {
    expect(flags).toContain(
      '--disable-features=ExtensionDisableUnsupportedDeveloper'
    )
  })
})

describe('chromium load outcome when the browser cannot load an extension', () => {
  it('marks a missing loadUnpacked method as unsupported', async () => {
    const outcome = await loadUnpacked(
      cdpThatFailsWith(-32601, "'Extensions.loadUnpacked' wasn't found"),
      '/tmp/does-not-matter'
    )
    expect(outcome).toEqual({status: 'unknown', unsupported: true})
  })

  it('leaves other unknown outcomes unmarked', async () => {
    const outcome = await loadUnpacked(
      cdpThatFailsWith(-32602, 'Invalid parameters'),
      '/tmp/does-not-matter'
    )
    expect(outcome).toEqual({status: 'unknown'})
  })

  it('still reports a real refusal as refused', async () => {
    const outcome = await loadUnpacked(
      cdpThatFailsWith(-32000, 'Manifest file is missing or unreadable'),
      '/tmp/does-not-matter'
    )
    expect(outcome).toEqual({
      status: 'refused',
      reason: 'Manifest file is missing or unreadable'
    })
  })
})
